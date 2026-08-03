import 'server-only';

import OpenAI from 'openai';

import { REQUEST_TIMEOUT_MS } from './resilience';
import {
  ProviderError,
  type ChatMessage,
  type ChatProvider,
  type ChatStreamEvent,
  type KeyValidation,
  type ProviderModel,
  type StreamChatParams,
} from './types';

/**
 * The shared body of every OpenAI-compatible adapter.
 *
 * A growing number of providers speak OpenAI's wire format at a different base
 * URL. Writing a fresh adapter for each would mean re-implementing the same
 * stream parsing, the same usage extraction and the same abort handling — three
 * places for the same bug. This holds that once; `groq.ts` and `perplexity.ts`
 * are configuration.
 *
 * ⚠️ "OpenAI-compatible" is a claim, not a guarantee. The parts that actually
 * differ between these vendors are the ones this config exposes:
 *
 *  - **the output-cap parameter.** OpenAI renamed `max_tokens` to
 *    `max_completion_tokens`; some compatible APIs took the new name, others
 *    kept the old one and reject the new.
 *  - **`stream_options.include_usage`.** OpenAI omits usage from streamed
 *    responses unless asked. Providers that always send it may reject the
 *    parameter outright, which would fail every request rather than lose a
 *    token count.
 *  - **`GET /models`.** Not everyone has one.
 *
 * `openai.ts` deliberately does NOT use this. It is the reference
 * implementation of the interface and carries OpenAI-specific handling — the
 * `insufficient_quota` distinction, the 16-token probe floor — that would only
 * be noise here.
 */

export type CompatibleProviderConfig = {
  /** Must equal the `providers.name` row and the registry key. */
  name: string;
  /** How the provider is named in user-facing error messages. */
  label: string;
  baseURL: string;
  /**
   * The model `validateKey()` generates with.
   *
   * Cheapest available, because this runs on every admin dashboard render that
   * misses the health cache.
   *
   * A FUNCTION instead, for providers whose catalogue changes without notice.
   * A hardcoded id is a health check that starts failing the day the vendor
   * retires that model — and it fails as "the key is bad", which is the wrong
   * thing to tell an operator whose key is fine. The function receives the live
   * listing and picks; returning undefined means "nothing suitable", which is
   * reported as such rather than as an auth failure.
   */
  probeModel: string | ((listed: ProviderModel[]) => string | undefined);
  /** Some providers error rather than truncate on a tiny budget. */
  probeMaxTokens?: number;
  outputTokenParam?: 'max_tokens' | 'max_completion_tokens';
  /** False when the provider rejects the parameter rather than ignoring it. */
  requestUsageInStream?: boolean;
  /**
   * Live model listing. Providers without a `GET /models` endpoint supply a
   * documented list instead, so the admin page still has something to show.
   */
  models:
    | { source: 'endpoint'; include?: (id: string) => boolean }
    | { source: 'static'; list: ProviderModel[] };
};

function makeClient(apiKey: string, config: CompatibleProviderConfig): OpenAI {
  if (!apiKey) {
    throw new ProviderError('auth', `${config.label} is not configured.`, false);
  }
  return new OpenAI({
    apiKey,
    baseURL: config.baseURL,
    // Without this a hung provider holds the request for the route's full
    // maxDuration and the user watches a spinner that never resolves.
    timeout: REQUEST_TIMEOUT_MS,
    // Retries are handled once, in the chat route, so "3 attempts" means 3.
    maxRetries: 0,
  });
}

/**
 * Vendor failure → `ProviderError`.
 *
 * Status codes are used in preference to vendor error codes: the codes are the
 * least compatible part of an "OpenAI-compatible" API, while the statuses are
 * HTTP and mean what they say. Messages name the provider and carry no payload
 * — they are shown to users.
 */
export function normaliseCompatibleError(err: unknown, label: string): ProviderError {
  if (err instanceof ProviderError) return err;

  if (err instanceof OpenAI.APIError) {
    const code = typeof err.code === 'string' ? err.code : '';

    // Out of credit is not a rate limit even though both are often 429: one
    // clears in seconds, the other needs a payment. Telling someone to "try
    // again shortly" forever is worse than telling them nothing.
    if (code.includes('insufficient_quota') || code.includes('billing')) {
      return new ProviderError('quota', `${label} credit is exhausted.`, false);
    }
    if (err.status === 401 || err.status === 403) {
      return new ProviderError('auth', `${label} rejected the API key.`, false);
    }
    if (err.status === 402) {
      return new ProviderError('quota', `${label} credit is exhausted.`, false);
    }
    if (err.status === 429) {
      return new ProviderError('rate_limit', `${label} is rate limiting requests.`, true);
    }
    if (code.includes('context_length') || code.includes('context_window')) {
      return new ProviderError(
        'context_length',
        'This conversation is too long for the model.',
        false,
      );
    }
    if (err.status !== undefined && err.status >= 500) {
      return new ProviderError('provider', `${label} returned a server error.`, true);
    }
    return new ProviderError('provider', `${label} rejected the request.`, false);
  }

  if (err instanceof OpenAI.APIConnectionError) {
    return new ProviderError('network', `Could not reach ${label}.`, true);
  }
  return new ProviderError('unknown', `Unexpected error talking to ${label}.`, true);
}

/**
 * Images travel as `image_url` parts carrying a data: URI.
 *
 * Only sent for models flagged `supports_vision` in the database — the chat
 * route decides that, not this file. A provider whose models are text-only
 * simply never receives attachments.
 */
function toContent(message: ChatMessage): OpenAI.Chat.ChatCompletionUserMessageParam['content'] {
  const images = message.attachments?.filter((a) => a.kind === 'image') ?? [];
  if (images.length === 0) return message.content;

  return [
    ...images.map((a) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${a.mimeType};base64,${a.base64}` },
    })),
    { type: 'text' as const, text: message.content },
  ];
}

export function createOpenAICompatibleProvider(
  apiKey: string,
  config: CompatibleProviderConfig,
): ChatProvider {
  const client = makeClient(apiKey, config);
  const outputParam = config.outputTokenParam ?? 'max_completion_tokens';

  async function listModels(): Promise<ProviderModel[]> {
    if (config.models.source === 'static') return config.models.list;

    try {
      const page = await client.models.list();
      const include = config.models.source === 'endpoint' ? config.models.include : undefined;
      return page.data
        .filter((m) => (include ? include(m.id) : true))
        .map((m) => ({ id: m.id, displayName: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw normaliseCompatibleError(err, config.label);
    }
  }

  /**
   * Resolved once per adapter instance, not once per process: the adapter is
   * rebuilt whenever the key is read, so a retired model is picked up on the
   * next health check rather than surviving until a deploy.
   */
  let probePromise: Promise<string | undefined> | null = null;
  function resolveProbeModel(): Promise<string | undefined> {
    if (typeof config.probeModel === 'string') return Promise.resolve(config.probeModel);
    probePromise ??= listModels().then(config.probeModel);
    return probePromise;
  }

  const body = (model: string, maxTokens: number, messages: unknown[], stream: boolean) => ({
    model,
    [outputParam]: maxTokens,
    ...(stream && config.requestUsageInStream !== false
      ? { stream_options: { include_usage: true } }
      : {}),
    stream,
    messages,
  });

  return {
    name: config.name,

    async *streamChat(params: StreamChatParams): AsyncGenerator<ChatStreamEvent> {
      const { model, messages, maxTokens, signal, system } = params;

      try {
        const stream = await client.chat.completions.create(
          body(
            model,
            maxTokens,
            [
              // The system prompt is the first message, not a separate field.
              ...(system ? [{ role: 'system' as const, content: system }] : []),
              // Content PARTS are permitted only on user messages, so an
              // assistant turn stays a plain string.
              ...messages.map((m) =>
                m.role === 'user'
                  ? { role: 'user' as const, content: toContent(m) }
                  : { role: 'assistant' as const, content: m.content },
              ),
            ],
            true,
          ) as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
          { signal },
        );

        let inputTokens = 0;
        let outputTokens = 0;
        let stopReason: string | null = null;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) yield { type: 'text', text: delta };

          const finish = chunk.choices[0]?.finish_reason;
          if (finish) stopReason = finish;

          // Some providers put usage on the final chunk, some on every chunk.
          // Taking the last non-zero reading is correct for both.
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
            outputTokens = chunk.usage.completion_tokens ?? outputTokens;
          }
        }

        yield { type: 'done', inputTokens, outputTokens, stopReason };
      } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) return;

        const normalised = normaliseCompatibleError(err, config.label);
        console.error(`[${config.name}] stream failed:`, normalised.kind, err);
        yield {
          type: 'error',
          kind: normalised.kind,
          message: normalised.message,
          retryable: normalised.retryable,
        };
      }
    },

    listModels,

    async validateKey(): Promise<KeyValidation> {
      const started = Date.now();
      try {
        const probe = await resolveProbeModel();
        if (!probe) {
          // Distinct from an auth failure on purpose. "The key is bad" and
          // "the vendor lists nothing we can run" need different actions, and
          // reporting the second as the first sends someone to rotate a key
          // that was never the problem.
          return {
            valid: false,
            reason: `${config.label} listed no model this app can use.`,
            latencyMs: Date.now() - started,
          };
        }

        // A real generation, never a models list: an unfunded key lists models
        // perfectly happily and fails only when asked to do work. Phase 3 was
        // blocked by exactly that, twice (ISSUE-012).
        await client.chat.completions.create(
          body(
            probe,
            config.probeMaxTokens ?? 16,
            [{ role: 'user' as const, content: 'hi' }],
            false,
          ) as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        );
        return { valid: true, latencyMs: Date.now() - started };
      } catch (err) {
        const normalised = normaliseCompatibleError(err, config.label);
        return { valid: false, reason: normalised.message, latencyMs: Date.now() - started };
      }
    },
  };
}
