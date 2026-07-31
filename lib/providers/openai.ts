import 'server-only';

import OpenAI from 'openai';

import {
  ProviderError,
  type ChatProvider,
  type ChatStreamEvent,
  type KeyValidation,
  type ProviderModel,
  type StreamChatParams,
} from './types';

/**
 * OpenAI adapter.
 *
 * This file exists to prove the abstraction: it is the ONLY place in the
 * codebase that knows OpenAI's API shape. Compare it with anthropic.ts — the
 * two differ substantially inside, and not at all from the outside.
 */

/** Models whose ids we filter the catalogue down to when listing. */
const CHAT_MODEL_PATTERN = /^(gpt-[45]|o[1-9])/;
const NON_CHAT_PATTERN =
  /transcribe|tts|audio|realtime|embedding|moderation|image|search-api|codex/;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ProviderError('auth', 'OpenAI is not configured.', false);
    client = new OpenAI({ apiKey });
  }
  return client;
}

function normalise(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;

  if (err instanceof OpenAI.APIError) {
    // `insufficient_quota` is distinct from a rate limit even though both are
    // 429: one clears in seconds, the other needs a payment. Conflating them
    // would tell the user to "try again shortly" forever.
    if (err.code === 'insufficient_quota') {
      return new ProviderError('quota', 'OpenAI credit is exhausted.', false);
    }
    if (err.status === 401) {
      return new ProviderError('auth', 'OpenAI rejected the API key.', false);
    }
    if (err.status === 429) {
      return new ProviderError('rate_limit', 'OpenAI is rate limiting requests.', true);
    }
    if (err.code === 'context_length_exceeded') {
      return new ProviderError(
        'context_length',
        'This conversation is too long for the model.',
        false,
      );
    }
    if (err.status !== undefined && err.status >= 500) {
      return new ProviderError('provider', 'OpenAI returned a server error.', true);
    }
    return new ProviderError('provider', 'OpenAI rejected the request.', false);
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new ProviderError('network', 'Could not reach OpenAI.', true);
  }
  return new ProviderError('unknown', 'Unexpected error talking to OpenAI.', true);
}

export const openaiProvider: ChatProvider = {
  name: 'openai',

  async *streamChat(params: StreamChatParams): AsyncGenerator<ChatStreamEvent> {
    const { model, messages, maxTokens, signal, system } = params;

    try {
      const stream = await getClient().chat.completions.create(
        {
          model,
          // GPT-5-series rejects `max_tokens`; the parameter was renamed.
          max_completion_tokens: maxTokens,
          // Usage is omitted from streamed responses unless explicitly requested.
          stream_options: { include_usage: true },
          stream: true,
          messages: [
            // OpenAI takes the system prompt as the first message rather than
            // a separate field, which is the main shape difference here.
            ...(system ? [{ role: 'system' as const, content: system }] : []),
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        },
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

        // Arrives in a final chunk that carries no choices.
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }
      }

      yield { type: 'done', inputTokens, outputTokens, stopReason };
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) return;

      const normalised = normalise(err);
      console.error('[openai] stream failed:', normalised.kind, err);
      yield {
        type: 'error',
        kind: normalised.kind,
        message: normalised.message,
        retryable: normalised.retryable,
      };
    }
  },

  async listModels(): Promise<ProviderModel[]> {
    try {
      const page = await getClient().models.list();
      return page.data
        .filter((m) => CHAT_MODEL_PATTERN.test(m.id) && !NON_CHAT_PATTERN.test(m.id))
        .map((m) => ({ id: m.id, displayName: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw normalise(err);
    }
  },

  async validateKey(): Promise<KeyValidation> {
    const started = Date.now();
    try {
      // Deliberately a generation, not a models.list(): an unfunded key lists
      // models happily and fails only when asked to do work. Phase 3 was
      // briefly blocked by exactly that, so the check has to spend a token.
      //
      // 16 tokens, not 1: unlike Anthropic, OpenAI raises invalid_request_error
      // rather than truncating when the budget can't fit a complete message —
      // a 1-token probe fails on a perfectly healthy key.
      await getClient().chat.completions.create({
        model: 'gpt-5.4-nano',
        max_completion_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return { valid: true, latencyMs: Date.now() - started };
    } catch (err) {
      const normalised = normalise(err);
      return { valid: false, reason: normalised.message, latencyMs: Date.now() - started };
    }
  },
};
