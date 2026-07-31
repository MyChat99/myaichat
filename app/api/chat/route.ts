import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/db/admin';
import { createClient } from '@/lib/db/server';
import { defaultModel, getAdapter, resolveModel } from '@/lib/providers/registry';
import { ProviderError, type ChatMessage } from '@/lib/providers/types';
import { fetchObject, isStorageConfigured, keyBelongsToUser } from '@/lib/r2/storage';
import { checkChatRateLimit } from '@/lib/security/rate-limit';
import { checkDailyTokenBudget } from '@/lib/security/token-budget';

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
        kind: z.enum(['image', 'document', 'text']),
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

  // Ownership check runs through the user's own client, so RLS enforces it.
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, title, model_id')
    .eq('id', conversationId)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  // Suspension is enforced by RLS as well (migration 20260730120005), so a
  // bypass of this check still cannot write. This is here to return a clear
  // 403 rather than an opaque insert failure.
  const { data: profile } = await supabase
    .from('profiles')
    .select('suspended')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.suspended) {
    return NextResponse.json(
      { error: 'Your account is suspended. Contact an administrator.' },
      { status: 403 },
    );
  }

  const rate = await checkChatRateLimit(user.id);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `Hourly limit of ${rate.limit} messages reached.`, retryable: true },
      { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } },
    );
  }

  // Spend ceiling, separate from the message counter above: sixty messages an
  // hour of very large context is a bill that a message count never sees.
  const budget = await checkDailyTokenBudget(user.id);
  if (!budget.allowed) {
    return NextResponse.json(
      {
        error: `Daily token budget of ${budget.limit.toLocaleString()} reached (used ${budget.used.toLocaleString()}). Resets at 00:00 UTC.`,
        retryable: false,
      },
      { status: 429 },
    );
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

    const wantsImage = attachments.some((a) => a.kind === 'image');
    const wantsDocument = attachments.some((a) => a.kind === 'document');

    if (wantsImage && !model.supportsVision) {
      return NextResponse.json(
        { error: `${model.displayName} cannot read images. Pick a vision-capable model.` },
        { status: 422 },
      );
    }
    if (wantsDocument && !model.supportsDocuments) {
      return NextResponse.json(
        { error: `${model.displayName} cannot read documents. Pick a document-capable model.` },
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

  // Regenerate / edit: drop the target message and everything after it.
  if (truncateFromMessageId) {
    const { data: pivot } = await supabase
      .from('messages')
      .select('created_at')
      .eq('id', truncateFromMessageId)
      .eq('conversation_id', conversationId)
      .single();

    if (pivot) {
      await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId)
        .gte('created_at', pivot.created_at);
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

  const { data: history } = await supabase
    .from('messages')
    .select('role, content, attachments')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(MAX_HISTORY_MESSAGES);

  const messages: ChatMessage[] = (history ?? [])
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
      const hydrated = await Promise.all(
        attachments
          .filter((a) => a.kind !== 'text')
          .map(async (a) => {
            const object = await fetchObject(a.key);
            return {
              kind: a.kind as 'image' | 'document',
              mimeType: object.mimeType || a.mimeType,
              base64: object.base64,
              name: a.name,
            };
          }),
      );
      if (hydrated.length) last.attachments = hydrated;
    }
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: 'Nothing to send.' }, { status: 400 });
  }

  if (conversation.title === 'New chat' && messages[0]) {
    await supabase
      .from('conversations')
      .update({ title: deriveTitle(messages[0].content) })
      .eq('id', conversationId);
  }

  // Resolves the encrypted key and builds a configured adapter. Throws a
  // ProviderError when the provider is disabled or has no usable key.
  let adapter;
  try {
    adapter = await getAdapter(model.providerName);
  } catch (err) {
    const message =
      err instanceof ProviderError ? err.message : 'That model is currently unavailable.';
    return NextResponse.json({ error: message }, { status: 503 });
  }

  // Aborts when the client disconnects or presses Stop — this is what makes the
  // stop button halt generation upstream rather than just hiding output.
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = '';
      let inputTokens = 0;
      let outputTokens = 0;

      try {
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
      } catch (err) {
        console.error('[api/chat] stream error:', err);
        controller.enqueue(
          ndjson({ type: 'error', kind: 'unknown', message: 'Streaming failed.', retryable: true }),
        );
      }

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
        });

        controller.enqueue(
          ndjson({ type: 'done', messageId: saved?.id ?? null, inputTokens, outputTokens }),
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
