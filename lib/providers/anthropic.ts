import 'server-only';

import { REQUEST_TIMEOUT_MS } from './resilience';

import Anthropic from '@anthropic-ai/sdk';

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
 * Anthropic adapter.
 *
 * `server-only`: the API key must never reach a client bundle (CLAUDE.md rule 1).
 * Phase 4 swaps the env var for the AES-256-GCM value in
 * `providers.encrypted_api_key` — only `client` changes.
 */

/**
 * Built per API key rather than as a singleton: since Phase 4 the key comes
 * from the encrypted `providers.encrypted_api_key` column, so it can be
 * rotated at runtime and differs per provider row.
 */
function makeClient(apiKey: string): Anthropic {
  if (!apiKey) throw new ProviderError('auth', 'Anthropic is not configured.', false);
  return new Anthropic({
    apiKey,
    // Without this a hung provider holds the request for the route's full
    // 300s maxDuration, and the user watches a spinner that never resolves.
    timeout: REQUEST_TIMEOUT_MS,
    // Retries are handled once, in the chat route, so the policy does not
    // depend on which model was picked — and so "3 attempts" means 3 rather
    // than 3 × whatever this SDK does by default.
    maxRetries: 0,
  });
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

/**
 * Anthropic takes images and PDFs as separate content blocks alongside text.
 *
 * Attachment blocks come FIRST: the model reads the file before the instruction
 * about it, which is what Anthropic's own guidance recommends and which reads
 * more sensibly when the text refers to "this image".
 */
function toContent(message: ChatMessage): Anthropic.MessageParam['content'] {
  if (!message.attachments?.length) return message.content;

  const blocks: Anthropic.ContentBlockParam[] = [];

  for (const a of message.attachments) {
    if (a.kind === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: a.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
          data: a.base64,
        },
      });
    } else {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: a.base64 },
      });
    }
  }

  blocks.push({ type: 'text', text: message.content });
  return blocks;
}

export const ANTHROPIC_PROVIDER_NAME = 'anthropic';

export function createAnthropicProvider(apiKey: string): ChatProvider {
  const client = makeClient(apiKey);

  return {
    name: ANTHROPIC_PROVIDER_NAME,

    async *streamChat(params: StreamChatParams): AsyncGenerator<ChatStreamEvent> {
      const { model, messages, maxTokens, signal, system } = params;

      try {
        const stream = client.messages.stream(
          {
            model,
            max_tokens: maxTokens,
            // Thinking is ON by default on Opus 5 — this is an explicit opt-out
            // for chat latency (DECISIONS.md DEC-008). Only valid at effort
            // `high` or below, which is the default.
            thinking: { type: 'disabled' },
            system,
            messages: messages.map((m) => ({ role: m.role, content: toContent(m) })),
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
        const page = await client.models.list({ limit: 100 });
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
        await client.messages.create({
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
}
