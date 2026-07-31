import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import {
  ProviderError,
  type ChatProvider,
  type ChatStreamEvent,
  type KeyValidation,
  type ProviderModel,
  type StreamChatParams,
} from './types';

/**
 * Anthropic adapter.
 *
 * `server-only`: the API key must never reach a client bundle (CLAUDE.md rule 1).
 * Phase 4 swaps the env var for the AES-256-GCM value in
 * `providers.encrypted_api_key` — only `getClient()` changes.
 */

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ProviderError('auth', 'Anthropic is not configured.', false);
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Maps SDK errors onto the shared kinds, without leaking key material. */
function normalise(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;

  if (err instanceof Anthropic.AuthenticationError) {
    return new ProviderError('auth', 'Anthropic rejected the API key.', false);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError('rate_limit', 'Anthropic is rate limiting requests.', true);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError('network', 'Could not reach Anthropic.', true);
  }
  if (err instanceof Anthropic.APIError) {
    // 400s here are usually an over-long conversation.
    if (err.status === 400 && /token|context|long/i.test(err.message)) {
      return new ProviderError(
        'context_length',
        'This conversation is too long for the model.',
        false,
      );
    }
    if (err.status === 403 || /credit|billing|quota/i.test(err.message)) {
      return new ProviderError('quota', 'Anthropic credit is exhausted.', false);
    }
    if (err.status !== undefined && err.status >= 500) {
      return new ProviderError('provider', 'Anthropic returned a server error.', true);
    }
    return new ProviderError('provider', 'Anthropic rejected the request.', false);
  }
  return new ProviderError('unknown', 'Unexpected error talking to Anthropic.', true);
}

export const anthropicProvider: ChatProvider = {
  name: 'anthropic',

  async *streamChat(params: StreamChatParams): AsyncGenerator<ChatStreamEvent> {
    const { model, messages, maxTokens, signal, system } = params;

    try {
      const stream = getClient().messages.stream(
        {
          model,
          max_tokens: maxTokens,
          // Thinking is ON by default on Opus 5 — this is an explicit opt-out
          // for chat latency (DECISIONS.md DEC-008). Only valid at effort
          // `high` or below, which is the default.
          thinking: { type: 'disabled' },
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();
      yield {
        type: 'done',
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        stopReason: final.stop_reason,
      };
    } catch (err) {
      // An aborted stream is the user pressing Stop, not a failure.
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) return;

      const normalised = normalise(err);
      console.error('[anthropic] stream failed:', normalised.kind, err);
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
      const page = await getClient().models.list({ limit: 100 });
      return page.data.map((m) => ({ id: m.id, displayName: m.display_name }));
    } catch (err) {
      throw normalise(err);
    }
  },

  async validateKey(): Promise<KeyValidation> {
    const started = Date.now();
    try {
      // Listing models proves authentication but NOT billing — a key with no
      // credit lists fine and fails on generation. A one-token completion is
      // the only check that proves the key can actually do work.
      await getClient().messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return { valid: true, latencyMs: Date.now() - started };
    } catch (err) {
      const normalised = normalise(err);
      return { valid: false, reason: normalised.message, latencyMs: Date.now() - started };
    }
  },
};
