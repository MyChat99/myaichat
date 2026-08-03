import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/db/admin';
import { createClient } from '@/lib/db/server';
import { defaultModel, getAdapter, resolveModel } from '@/lib/providers/registry';
import { isRetryableKind, withRetry } from '@/lib/providers/resilience';
import { ProviderError, type ChatMessage } from '@/lib/providers/types';
import { fetchObject, isStorageConfigured, keyBelongsToUser } from '@/lib/r2/storage';
import {
  ExtractionError,
  contentMatchesType,
  extractAttachmentText,
  fenceExtracted,
} from '@/lib/upload/extract';
import { requiredCapability, type AttachmentKind } from '@/lib/upload/types';
import { AppError, fromProviderKind, toAppError } from '@/lib/errors/app-error';
import { logRequest, newRequestId, outcomeFor } from '@/lib/observability/log';
import { checkChatRateLimit } from '@/lib/security/rate-limit';
import { checkDailyTokenBudget } from '@/lib/security/token-budget';
import { CEILING_MESSAGE, checkMonthlySpendCeiling } from '@/lib/security/spend-ceiling';

/**
 * Streaming chat endpoint — provider-agnostic.
 *
 * This file names no vendor and imports no vendor SDK. It resolves the
 * conversation's model through the registry and talks to whatever adapter
 * comes back, so a third provider needs no change here.
 *
 * Wire format is newline-delimited JSON rather than SSE: this is a POST (so
 * EventSource is unusable) and NDJSON is trivially parseable from a fetch reader.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_TOKENS = 8192;
/** Guards the context window and the bill; older turns are dropped, not summarised. */
const MAX_HISTORY_MESSAGES = 40;

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  /** Omit when regenerating: the last user message already exists in the DB. */
  message: z.string().trim().min(1).max(100_000).optional(),
  /** Drop this message and everything after it, then resend. Used by edit + regenerate. */
  truncateFromMessageId: z.string().uuid().optional(),
  /** R2 object keys from /api/uploads/presign. Ownership is re-checked here. */
  attachments: z
    .array(
      z.object({
        key: z.string().min(1).max(512),
        name: z.string().min(1).max(255),
        mimeType: z.string().min(1).max(128),
        sizeBytes: z.number().int().positive(),
        kind: z.enum(['image', 'document', 'text', 'office']),
      }),
    )
    .max(5)
    .optional(),
});

function ndjson(event: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

function deriveTitle(text: string): string {
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? 'New chat';
  const clean = firstLine.trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

/**
 * Telling the model what it is.
 *
 * Without this an LLM cannot reliably name its own version — models ship after
 * their training cutoff, so they genuinely do not know. Passing the selected
 * model's display name makes "which model are you?" answerable.
 */
function systemPrompt(displayName: string): string {
  return [
    `You are ${displayName}, an AI assistant in a chat application.`,
    'Format responses in Markdown. Use fenced code blocks with a language tag for code.',
    // Generic tag instruction, NOT a don't-reason instruction — the latter
    // makes internal-tag leakage worse on thinking-disabled models. See DEC-008.
    'Do not include internal or system XML tags in your response.',
  ].join(' ');
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const startedAt = Date.now();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { conversationId, message, truncateFromMessageId, attachments } = body;

  /**
   * The four pre-flight checks, issued together.
   *
   * They were sequential, and each is a separate network round trip to
   * Supabase — measured at ~600ms of our own latency before the provider was
   * even called, on every single message. None of them depends on another:
   * ownership needs the conversation id, suspension and both limits need only
   * the user id.
   *
   * The RESULTS are still evaluated in the original order, so an identical
   * request produces an identical status code. That ordering is not cosmetic —
   * a foreign conversation must 404 before a rate limit can 429, or the
   * refusal tells the caller that someone else's conversation exists.
   *
   * The cost of issuing them together is doing a little work for requests that
   * were going to be refused anyway. Four cheap indexed reads is a good trade
   * for half a second on every accepted one.
   */
  const [conversationResult, profileResult, rate, budget, ceiling] = await Promise.all([
    // Ownership runs through the user's own client, so RLS enforces it.
    supabase.from('conversations').select('id, title, model_id').eq('id', conversationId).single(),
    // Suspension is enforced by RLS too (migration 20260730120005), so a bypass
    // of this check still cannot write. This returns a clear 403 rather than an
    // opaque insert failure.
    supabase.from('profiles').select('suspended').eq('id', user.id).maybeSingle(),
    checkChatRateLimit(user.id),
    // Spend ceiling, separate from the message counter: sixty messages an hour
    // of very large context is a bill a message count never sees.
    checkDailyTokenBudget(user.id),
    // The deployment-wide ceiling. Issued with the others rather than after
    // them: it is one more read, and a spend control that costs a round trip
    // per message is a spend control someone will be tempted to remove.
    checkMonthlySpendCeiling(),
  ]);

  const conversation = conversationResult.data;

  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  if (profileResult.data?.suspended) {
    return NextResponse.json(
      { error: 'Your account is suspended. Contact an administrator.' },
      { status: 403 },
    );
  }

  if (!rate.allowed) {
    return NextResponse.json(
      { error: `Hourly limit of ${rate.limit} messages reached.`, retryable: true },
      { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } },
    );
  }

  if (!budget.allowed) {
    return NextResponse.json(
      {
        error: `Daily token budget of ${budget.limit.toLocaleString()} reached (used ${budget.used.toLocaleString()}). Resets at 00:00 UTC.`,
        retryable: false,
      },
      { status: 429 },
    );
  }

  /**
   * Evaluated last of the refusals, so a user who is over their own budget is
   * told about their own budget rather than about the deployment's — the first
   * is something they can act on.
   */
  if (!ceiling.allowed) {
    return NextResponse.json({ error: CEILING_MESSAGE, retryable: false }, { status: 429 });
  }

  // Resolve which model to call. `resolveModel` returns null when the pinned
  // model was disabled or deleted, so fall back rather than 500.
  const model =
    (conversation.model_id ? await resolveModel(conversation.model_id) : null) ??
    (await defaultModel());

  if (!model) {
    return NextResponse.json(
      { error: 'No model is configured. Run `npm run seed`.' },
      { status: 503 },
    );
  }

  if (conversation.model_id !== model.id) {
    await supabase.from('conversations').update({ model_id: model.id }).eq('id', conversationId);
  }

  // Attachments: verify ownership, then check the model can actually read them.
  // Refusing up front is far better than silently dropping the file and letting
  // the model answer as though it had seen something.
  if (attachments?.length) {
    const foreign = attachments.find((a) => !keyBelongsToUser(a.key, user.id));
    if (foreign) {
      return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    }

    /**
     * Only the kinds delivered NATIVELY need a capability.
     *
     * `text` and `office` are extracted to plain text before they reach a
     * provider, so by then they are ordinary prompt content and every model can
     * read them. Gating those on `supportsDocuments` — as an earlier version of
     * this check would have — would refuse a spreadsheet on a model perfectly
     * able to read the table we hand it.
     */
    const needsVision = attachments.some(
      (a) => requiredCapability(a.kind as AttachmentKind) === 'vision',
    );
    const needsDocuments = attachments.some(
      (a) => requiredCapability(a.kind as AttachmentKind) === 'documents',
    );

    if (needsVision && !model.supportsVision) {
      return NextResponse.json(
        {
          error: `${model.displayName} can't read images. Choose a vision model, or attach a document instead.`,
        },
        { status: 422 },
      );
    }
    if (needsDocuments && !model.supportsDocuments) {
      return NextResponse.json(
        {
          error: `${model.displayName} can't read PDFs. Choose a document-capable model, or paste the text.`,
        },
        { status: 422 },
      );
    }
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File uploads are not configured on this deployment.' },
        { status: 503 },
      );
    }
  }

  const admin = createAdminClient();

  /**
   * Regenerate / edit: drop the target message and everything after it.
   *
   * Boundary is `seq`, not `created_at`. `created_at` defaults to `now()`,
   * which is TRANSACTION time — every row written by one statement shares a
   * value, so `>= pivot.created_at` could sweep up a message that came *before*
   * the pivot and merely landed in the same transaction. Regenerating an
   * assistant reply would then delete the question that prompted it
   * (ISSUE-024). `seq` is monotonic, so the boundary is exact.
   */
  if (truncateFromMessageId) {
    const { data: pivot } = await supabase
      .from('messages')
      .select('seq')
      .eq('id', truncateFromMessageId)
      .eq('conversation_id', conversationId)
      .single();

    if (pivot) {
      await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId)
        .gte('seq', pivot.seq);
    }
  }

  if (message) {
    const { error: insertError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: message,
      attachments: (attachments ?? []) as never,
    });

    if (insertError) {
      return NextResponse.json({ error: 'Could not save your message.' }, { status: 500 });
    }
  }

  /**
   * The most recent turns, in chronological order.
   *
   * ⚠️ The ordering here is load-bearing. `ascending: true` with a LIMIT
   * returns the OLDEST rows — so once a conversation passed
   * MAX_HISTORY_MESSAGES the model was sent the beginning of the thread and
   * never saw the question that had just been asked. It answered, fluently,
   * about something from forty messages ago. Nothing errored, which is why it
   * survived: the only symptom is an assistant that seems to stop paying
   * attention on long threads.
   *
   * Newest-first with a limit, then reversed, is what "keep the last N" has to
   * be in SQL.
   *
   * Ordered by `seq` rather than `created_at` for the same reason the deletion
   * above is: a tie at the window edge would make which message falls inside
   * the window arbitrary.
   */
  const { data: recent } = await supabase
    .from('messages')
    .select('role, content, attachments')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  const history = (recent ?? []).reverse();

  const messages: ChatMessage[] = history
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  /**
   * Hydrate attachment bytes for the LAST user turn only.
   *
   * Deliberately not the whole history: re-sending every image on every turn
   * would multiply token cost without adding information the model has not
   * already seen described in its own earlier replies.
   */
  if (attachments?.length && messages.length > 0) {
    const last = messages[messages.length - 1];
    if (last.role === 'user') {
      /**
       * A missing object is a 400, not a 500.
       *
       * `fetchObject` throws if the key is not in the bucket — an object that
       * was deleted, expired, or a key the client held on to after the upload
       * failed. Unhandled, that surfaced as a bare 500 with a vendor stack in
       * the server log and nothing the user could act on. It is a bad request:
       * the attachment they are sending does not exist, and telling them to
       * remove and re-attach it is something they can actually do.
       */
      let missing: string | null = null;
      let unreadable: string | null = null;
      let wrongContent: string | null = null;

      /**
       * Every attachment is fetched once, then routed by how it reaches the
       * model. Before this, `text` attachments were filtered out here and
       * nowhere else — so a .txt or .md could be attached, stored, shown as a
       * chip, and never reach the model at all. The answer came back as if the
       * file had been read.
       */
      const native: {
        kind: 'image' | 'document';
        mimeType: string;
        base64: string;
        name: string;
      }[] = [];
      const extracted: string[] = [];

      for (const a of attachments) {
        let object: { base64: string; mimeType: string };
        try {
          object = await fetchObject(a.key);
        } catch {
          // The NAME, never the key: the key is a storage path containing the
          // owner's user id.
          missing = a.name;
          break;
        }

        const bytes = Buffer.from(object.base64, 'base64');
        const mimeType = a.mimeType;

        /**
         * The type is re-derived from the bytes here, at the only point where
         * we actually hold them. Both the extension and the declared MIME type
         * were chosen by whoever uploaded the file; this is the check that was
         * not.
         */
        if (!contentMatchesType(mimeType, bytes)) {
          wrongContent = a.name;
          break;
        }

        if (a.kind === 'image' || a.kind === 'document') {
          native.push({
            kind: a.kind,
            mimeType: object.mimeType || mimeType,
            base64: object.base64,
            name: a.name,
          });
          continue;
        }

        try {
          extracted.push(fenceExtracted(a.name, mimeType, extractAttachmentText(mimeType, bytes)));
        } catch (err) {
          unreadable =
            err instanceof ExtractionError ? `"${a.name}" — ${err.message}` : `"${a.name}"`;
          break;
        }
      }

      if (missing) {
        return NextResponse.json(
          {
            error: `"${missing}" could not be read from storage. Remove it and attach it again.`,
            retryable: false,
          },
          { status: 400 },
        );
      }

      if (wrongContent) {
        return NextResponse.json(
          {
            error: `"${wrongContent}" is not the kind of file its name says it is. Remove it and attach it again.`,
            retryable: false,
          },
          { status: 400 },
        );
      }

      if (unreadable) {
        return NextResponse.json(
          { error: `${unreadable}. Remove it, or attach it in another format.`, retryable: false },
          { status: 422 },
        );
      }

      if (native.length) last.attachments = native;

      // Extracted text rides in the message body, before the user's own words,
      // so a model reading top to bottom has the document before the question.
      if (extracted.length) {
        last.content = `${extracted.join('\n\n')}\n\n${last.content}`;
      }
    }
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: 'Nothing to send.' }, { status: 400 });
  }

  /**
   * Title from the thread's FIRST message, fetched explicitly.
   *
   * It used to read `messages[0]`, which was the first message only because
   * history happened to be ordered oldest-first — the same ordering that was
   * the bug above. Fixing that would have silently retitled long threads from
   * whatever message happened to fall at the window edge. One extra query on a
   * path that runs once per conversation is worth not depending on that.
   */
  if (conversation.title === 'New chat') {
    const { data: first } = await supabase
      .from('messages')
      .select('content')
      .eq('conversation_id', conversationId)
      .eq('role', 'user')
      .order('seq', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (first?.content) {
      await supabase
        .from('conversations')
        .update({ title: deriveTitle(first.content) })
        .eq('id', conversationId);
    }
  }

  // Resolves the encrypted key and builds a configured adapter. Throws a
  // ProviderError when the provider is disabled or has no usable key.
  let adapter;
  try {
    adapter = await getAdapter(model.providerName);
  } catch (err) {
    // Through the shared taxonomy so the client gets `kind` and `retryable`
    // rather than only a sentence — the UI decides whether to offer a retry
    // button from the flag, and a bare 503 gives it nothing to decide with.
    const failure =
      err instanceof ProviderError
        ? new AppError('provider', fromProviderKind(err.kind), err.message, String(err.message))
        : toAppError(err, 'provider');

    logRequest({
      requestId,
      route: '/api/chat',
      method: 'POST',
      status: failure.status,
      outcome: outcomeFor(failure.status),
      durationMs: Date.now() - startedAt,
      userId: user.id,
      dependency: failure.dependency,
      kind: failure.kind,
      model: model.modelId,
      detail: failure.detail,
    });
    return NextResponse.json(failure.toBody(), { status: failure.status });
  }

  // Aborts when the client disconnects or presses Stop — this is what makes the
  // stop button halt generation upstream rather than just hiding output.
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());

  // Everything above is ours; everything below is the provider's. This is the
  // boundary the prepMs figure measures to.
  const prepMs = Date.now() - startedAt;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = '';
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        /**
         * Retried only until the first token.
         *
         * `hasEmittedOutput` is what makes this safe. Once any text has reached
         * the client, a retry would append a second answer to a partial first
         * one — the model appears to stammer, and the exchange is billed twice.
         * A transient failure during connection is worth another attempt; the
         * same failure after 200 tokens is not.
         *
         * The abort signal is honoured throughout: a user pressing Stop must
         * not be answered with a retry.
         */
        await withRetry(
          async () => {
            for await (const event of adapter.streamChat({
              model: model.modelId,
              system: systemPrompt(model.displayName),
              messages,
              maxTokens: Math.min(model.maxTokens, MAX_TOKENS),
              signal: abort.signal,
            })) {
              if (event.type === 'text') {
                assistantText += event.text;
                controller.enqueue(ndjson({ type: 'text', text: event.text }));
              } else if (event.type === 'done') {
                inputTokens = event.inputTokens;
                outputTokens = event.outputTokens;
              } else if (event.type === 'error') {
                controller.enqueue(ndjson(event));
              }
            }
          },
          {
            hasEmittedOutput: () => assistantText.length > 0,
            isRetryable: (err) => {
              if (abort.signal.aborted) return false;
              return err instanceof ProviderError && isRetryableKind(err.kind);
            },
            onRetry: ({ attempt, err }) => {
              // Logged in the same shape as everything else, so a retry storm
              // is one query away rather than a string nobody thought to grep.
              logRequest({
                requestId,
                route: '/api/chat',
                method: 'POST',
                status: 503,
                outcome: 'server_error',
                durationMs: Date.now() - startedAt,
                userId: user.id,
                dependency: 'provider',
                kind: err instanceof ProviderError ? err.kind : 'unknown',
                model: model.modelId,
                attempts: attempt,
              });
            },
          },
        );
      } catch (err) {
        /**
         * Classified rather than blanket-retryable.
         *
         * This previously emitted `retryable: true` for everything, so a
         * mid-stream rejection of our API key told the user to try again — and
         * every retry burned another request against a key that was never going
         * to work. The flag now comes from the failure.
         */
        const failure =
          err instanceof ProviderError
            ? new AppError('provider', fromProviderKind(err.kind), err.message, String(err.message))
            : toAppError(err, 'provider');

        logRequest({
          requestId,
          route: '/api/chat',
          method: 'POST',
          status: failure.status,
          outcome: outcomeFor(failure.status),
          durationMs: Date.now() - startedAt,
          userId: user.id,
          dependency: failure.dependency,
          kind: failure.kind,
          model: model.modelId,
          prepMs,
          detail: failure.detail,
        });
        controller.enqueue(
          ndjson({
            type: 'error',
            kind: failure.kind,
            message: failure.message,
            retryable: failure.retryable,
          }),
        );
      }

      // One line per completed turn. The success path logged nothing at all
      // before this, so the only observable requests were the failing ones —
      // which makes every latency question unanswerable.
      logRequest({
        requestId,
        route: '/api/chat',
        method: 'POST',
        status: 200,
        outcome: 'ok',
        durationMs: Date.now() - startedAt,
        prepMs,
        userId: user.id,
        model: model.modelId,
        inputTokens,
        outputTokens,
      });

      // Persist whatever was produced, including a partial from a stopped
      // stream — losing the user's partial answer would be worse than keeping it.
      if (assistantText.length > 0) {
        const { data: saved } = await admin
          .from('messages')
          .insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: assistantText,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          })
          .select('id')
          .single();

        await admin
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', conversationId);

        const estimatedCost =
          (inputTokens / 1000) * model.inputCostPer1k +
          (outputTokens / 1000) * model.outputCostPer1k;

        await admin.from('usage_logs').insert({
          user_id: user.id,
          model_id: model.id,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost: Number(estimatedCost.toFixed(6)),
          // What this answer cost, attached to the answer. Without the link the
          // app can say what today cost and never what a given reply did.
          message_id: saved?.id ?? null,
        });

        controller.enqueue(
          // The cost travels with the completion, so the answer carries its
          // price the moment it finishes rather than on the next page load.
          ndjson({
            type: 'done',
            messageId: saved?.id ?? null,
            inputTokens,
            outputTokens,
            costUsd: Number(estimatedCost.toFixed(6)),
          }),
        );
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
