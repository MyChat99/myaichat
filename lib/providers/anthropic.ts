import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import type { ChatProvider, ChatStreamEvent, StreamChatParams } from './types';

/**
 * Anthropic adapter.
 *
 * `server-only`: the API key must never reach a client bundle (CLAUDE.md rule 1).
 * Phase 2 reads it from the environment; Phase 4 swaps this for the AES-256-GCM
 * encrypted value in `providers.encrypted_api_key` — only `getClient()` changes.
 */

/**
 * Thinking is DISABLED for chat: snappier first token and lower cost, which is
 * the right trade for an interactive product (docs/wiki/DECISIONS.md DEC-008).
 *
 * With thinking off, Claude Opus 5 can occasionally emit internal XML into the
 * visible response. Anthropic's documented mitigation is a *generic* tag
 * instruction — and explicitly NOT an instruction telling the model not to
 * reason, which makes the leakage worse. Hence the wording below.
 */
const SYSTEM_PROMPT = [
  'You are a helpful AI assistant in a chat application.',
  'Format responses in Markdown. Use fenced code blocks with a language tag for code.',
  'Do not include internal or system XML tags in your response.',
].join(' ');

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Maps SDK errors onto our neutral event shape, without leaking key material. */
function toErrorEvent(err: unknown): ChatStreamEvent {
  if (err instanceof Anthropic.RateLimitError) {
    return {
      type: 'error',
      message: 'Rate limited by the provider. Try again shortly.',
      retryable: true,
    };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    // Deliberately vague to the client; the real cause is in the server log.
    return { type: 'error', message: 'Provider authentication failed.', retryable: false };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { type: 'error', message: 'Could not reach the provider.', retryable: true };
  }
  if (err instanceof Anthropic.APIError) {
    return {
      type: 'error',
      message: 'The provider returned an error.',
      retryable: err.status !== undefined && err.status >= 500,
    };
  }
  return { type: 'error', message: 'Unexpected error while streaming.', retryable: true };
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
          // Accepted at effort `high` or below — `high` is the default, so this
          // is valid. Pairing `disabled` with xhigh/max would be a 400.
          thinking: { type: 'disabled' },
          system: system ?? SYSTEM_PROMPT,
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

      console.error('[anthropic] stream failed:', err);
      yield toErrorEvent(err);
    }
  },
};
