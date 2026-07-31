/**
 * Provider-agnostic chat types.
 *
 * Phase 2 ships a single Anthropic adapter, but the shape is already the one
 * Phase 3's `ChatProvider` interface will formalise — so adding OpenAI means a
 * new adapter file, not a rewrite of the route or the UI.
 */

export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
  role: Exclude<ChatRole, 'system'>;
  content: string;
};

export type StreamChatParams = {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal?: AbortSignal;
};

/** Emitted as the provider streams. Deliberately provider-neutral. */
export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; inputTokens: number; outputTokens: number; stopReason: string | null }
  | { type: 'error'; message: string; retryable: boolean };

export interface ChatProvider {
  readonly name: string;
  streamChat(params: StreamChatParams): AsyncGenerator<ChatStreamEvent>;
}
