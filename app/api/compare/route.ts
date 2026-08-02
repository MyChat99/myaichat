import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/db/admin';
import { createClient } from '@/lib/db/server';
import { listAvailableModels, getAdapter } from '@/lib/providers/registry';
import { ProviderError } from '@/lib/providers/types';
import { toAppError } from '@/lib/errors/app-error';
import { logRequest, newRequestId, outcomeFor } from '@/lib/observability/log';
import { checkChatRateLimit } from '@/lib/security/rate-limit';
import { checkDailyTokenBudget } from '@/lib/security/token-budget';

/**
 * Ask the presses — one prompt, several models, at once.
 *
 * This route names no vendor, exactly like /api/chat: it resolves models from
 * the registry and streams whatever the adapters return. That it can run four
 * vendors side by side is a property of the abstraction, not of this file.
 *
 * ## Why it is a separate route
 *
 * /api/chat is a *conversation*: it owns history, titles, truncation, and
 * writes a message row. A comparison has none of that — it is one turn, several
 * answers, kept only long enough to read. Bolting a mode onto the chat route
 * would put a branch through all of that machinery for a request that uses none
 * of it.
 *
 * ## Cost
 *
 * A comparison spends N times a single turn, so it is gated by exactly the same
 * two controls as chat — the hourly message rate limit and the daily token
 * budget — and it refuses BEFORE spending anything rather than partway through.
 * Usage is written per model, so analytics and the budget stay accurate whether
 * a token was spent here or in a conversation.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Two is the point; four is the ceiling.
 *
 * Above four the columns stop being readable on any screen, and the spend
 * multiplier stops being something a user has intuition about.
 */
const MIN_MODELS = 2;
const MAX_MODELS = 4;

/** Short, because a comparison is for judging voice and approach, not length. */
const MAX_TOKENS = 1024;

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  modelIds: z.array(z.string().uuid()).min(MIN_MODELS).max(MAX_MODELS),
});

function ndjson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
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
    return NextResponse.json(
      { error: `Pick between ${MIN_MODELS} and ${MAX_MODELS} models and write a prompt.` },
      { status: 400 },
    );
  }

  // Same pre-flight as /api/chat, issued together and evaluated in a fixed
  // order so an identical request always produces an identical status.
  const [profileResult, rate, budget] = await Promise.all([
    supabase.from('profiles').select('suspended').eq('id', user.id).maybeSingle(),
    checkChatRateLimit(user.id),
    checkDailyTokenBudget(user.id),
  ]);

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
   * Resolve every requested model before spending anything.
   *
   * `listAvailableModels()` already excludes models whose provider has no key,
   * so an id that does not appear here is one the user could not legitimately
   * have been offered — refused rather than silently dropped, because running a
   * three-way comparison that quietly becomes two-way is a worse outcome than
   * being told which model is unavailable.
   */
  const offered = await listAvailableModels();
  const chosen = body.modelIds.map((id) => offered.find((m) => m.id === id) ?? null);

  if (chosen.some((m) => m === null)) {
    return NextResponse.json(
      { error: 'One of those models is no longer available. Reload and pick again.' },
      { status: 409 },
    );
  }

  const models = chosen as NonNullable<(typeof chosen)[number]>[];

  /**
   * The spend a comparison is about to commit, refused up front.
   *
   * The budget check above asks "has the user already exceeded it". This asks
   * the question that actually matters here: "would running N models take them
   * past it". Without this a comparison can start inside the budget and finish
   * well outside it, which is precisely the failure a spend ceiling exists to
   * prevent.
   */
  const worstCaseTokens = models.length * MAX_TOKENS;
  if (budget.limit > 0 && budget.used + worstCaseTokens > budget.limit) {
    return NextResponse.json(
      {
        error: `Comparing ${models.length} models could use ${worstCaseTokens.toLocaleString()} tokens and only ${(budget.limit - budget.used).toLocaleString()} remain today. Pick fewer models or wait for the reset at 00:00 UTC.`,
        retryable: false,
      },
      { status: 429 },
    );
  }

  const admin = createAdminClient();

  const stream = new ReadableStream({
    async start(controller) {
      /**
       * Every model runs concurrently and reports under its own id.
       *
       * Concurrent because a comparison read sequentially is not a comparison —
       * the point is watching them answer at the same time. Independent because
       * one provider being down must cost the user the other answers: each
       * column settles on its own, and a rejection is a `model_error` event on
       * that column rather than a failure of the request.
       */
      await Promise.all(
        models.map(async (model) => {
          const modelStartedAt = Date.now();
          let firstTokenAt: number | null = null;
          let inputTokens = 0;
          let outputTokens = 0;

          controller.enqueue(
            ndjson({ type: 'model_start', modelId: model.id, displayName: model.displayName }),
          );

          try {
            const adapter = await getAdapter(model.providerName);

            for await (const event of adapter.streamChat({
              model: model.modelId,
              system: `You are ${model.displayName}. Answer directly and concisely.`,
              messages: [{ role: 'user', content: body.prompt }],
              maxTokens: MAX_TOKENS,
            })) {
              if (event.type === 'text') {
                firstTokenAt ??= Date.now();
                controller.enqueue(ndjson({ type: 'text', modelId: model.id, text: event.text }));
              } else if (event.type === 'done') {
                inputTokens = event.inputTokens;
                outputTokens = event.outputTokens;
              } else if (event.type === 'error') {
                controller.enqueue(
                  ndjson({
                    type: 'model_error',
                    modelId: model.id,
                    message: event.message,
                    retryable: event.retryable,
                  }),
                );
                return;
              }
            }

            const costUsd =
              (inputTokens / 1000) * model.inputCostPer1k +
              (outputTokens / 1000) * model.outputCostPer1k;

            // Written even for a comparison, so the daily budget and the
            // analytics dashboards count tokens spent here exactly as they
            // count tokens spent in a conversation.
            await admin.from('usage_logs').insert({
              user_id: user.id,
              model_id: model.id,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              estimated_cost: Number(costUsd.toFixed(6)),
            });

            controller.enqueue(
              ndjson({
                type: 'model_done',
                modelId: model.id,
                inputTokens,
                outputTokens,
                costUsd: Number(costUsd.toFixed(6)),
                totalMs: Date.now() - modelStartedAt,
                // Time to first token: the number that decides whether a model
                // FEELS fast, which total duration hides entirely.
                firstTokenMs: firstTokenAt ? firstTokenAt - modelStartedAt : null,
              }),
            );
          } catch (err) {
            const failure =
              err instanceof ProviderError
                ? { message: err.message, retryable: err.retryable }
                : { message: toAppError(err, 'provider').message, retryable: false };

            controller.enqueue(ndjson({ type: 'model_error', modelId: model.id, ...failure }));
          }
        }),
      );

      logRequest({
        requestId,
        route: '/api/compare',
        method: 'POST',
        status: 200,
        outcome: outcomeFor(200),
        durationMs: Date.now() - startedAt,
        userId: user.id,
      });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** Exported for the contract test, so the limits cannot drift from the docs. */
export const COMPARE_LIMITS = { MIN_MODELS, MAX_MODELS, MAX_TOKENS };
