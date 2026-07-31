/**
 * The provider contract.
 *
 * Nothing outside this directory may import a vendor SDK or branch on a
 * provider name. Adding a provider means adding one adapter file here and
 * rows in `providers` / `models` — see lib/providers/README.md.
 */

export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
  role: Exclude<ChatRole, 'system'>;
  content: string;
};

export type StreamChatParams = {
  /** The provider's own model identifier, e.g. `claude-opus-5` or `gpt-5.4-mini`. */
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal?: AbortSignal;
};

/**
 * Normalised error kinds. The UI reacts to the kind, never to a vendor's
 * status code or message, so a new provider needs no UI changes.
 */
export type ProviderErrorKind =
  | 'auth' // key missing, invalid, or revoked
  | 'quota' // out of credit / billing not set up
  | 'rate_limit' // too many requests, retry later
  | 'context_length' // conversation exceeds the model's window
  | 'network' // could not reach the provider
  | 'provider' // provider-side failure (5xx)
  | 'unknown';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    /** Safe to show a user — must never contain key material or raw vendor payloads. */
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; inputTokens: number; outputTokens: number; stopReason: string | null }
  | { type: 'error'; kind: ProviderErrorKind; message: string; retryable: boolean };

/** A model as the provider reports it, before it is stored in the DB. */
export type ProviderModel = {
  id: string;
  displayName: string;
};

export type KeyValidation = {
  valid: boolean;
  /** Populated when invalid; safe to display. */
  reason?: string;
  /** Round-trip time in ms, for the Phase 4 "Test Connection" button. */
  latencyMs?: number;
};

export interface ChatProvider {
  /** Must match `providers.name` in the database. */
  readonly name: string;

  /** Streams a completion. Aborting `signal` must stop upstream generation. */
  streamChat(params: StreamChatParams): AsyncGenerator<ChatStreamEvent>;

  /** Live model list from the provider, for admin-side model management. */
  listModels(): Promise<ProviderModel[]>;

  /** Cheap round trip proving the credential works — auth alone is not enough. */
  validateKey(): Promise<KeyValidation>;
}
