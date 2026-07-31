/**
 * One error shape for every external dependency.
 *
 * The problem this solves is not "we lack an error class". It is that each
 * dependency failed in its own dialect: the chat route mapped `ProviderError`
 * kinds to sentences, the upload routes returned bespoke strings, email failed
 * silently, and a database outage produced whatever Supabase happened to say —
 * which is written for the developer who caused it, not the person reading it.
 *
 * Three rules hold for everything here:
 *
 *  1. **The message is the contract.** Every `AppError` carries a sentence
 *     already safe to show a user. Nothing downstream has to decide whether a
 *     given error is safe to render, because deciding that per call site is how
 *     a stack trace eventually reaches a browser.
 *  2. **Internals live in `detail`, which is logged and never returned.** The
 *     split is enforced by a test that pushes real failures through and greps
 *     the response.
 *  3. **`retryable` is about the failure, not about hope.** A 500 from a
 *     provider is retryable; a rejected key is not, and telling someone to try
 *     again when the answer will not change is worse than saying nothing.
 */

export type Dependency = 'database' | 'provider' | 'storage' | 'email' | 'config';

export type AppErrorKind =
  /** Credentials are missing or wrong. Not retryable — a human must act. */
  | 'unauthorised'
  /** The dependency is not set up on this deployment at all. */
  | 'unconfigured'
  /** Reached it, it refused: out of credit, over quota. */
  | 'exhausted'
  /** Reached it, it asked us to slow down. */
  | 'rate_limited'
  /** Could not reach it. Usually transient. */
  | 'unreachable'
  /** Reached it, it broke. Usually transient. */
  | 'upstream'
  /** The request itself was wrong. Never retryable. */
  | 'invalid'
  /** Anything unrecognised. Assumed not retryable, so we never loop on it. */
  | 'unknown';

const STATUS: Record<AppErrorKind, number> = {
  unauthorised: 503, // the USER is authenticated; OUR credential is the problem
  unconfigured: 503,
  exhausted: 503,
  rate_limited: 429,
  unreachable: 503,
  upstream: 502,
  invalid: 400,
  unknown: 500,
};

const RETRYABLE: Record<AppErrorKind, boolean> = {
  unauthorised: false,
  unconfigured: false,
  exhausted: false,
  rate_limited: true,
  unreachable: true,
  upstream: true,
  invalid: false,
  unknown: false,
};

export class AppError extends Error {
  readonly dependency: Dependency;
  readonly kind: AppErrorKind;
  /** Internals. Logged, never serialised to a client. */
  readonly detail?: string;

  constructor(
    dependency: Dependency,
    kind: AppErrorKind,
    /** Shown to a user verbatim. Must contain no internals. */
    message: string,
    detail?: string,
  ) {
    super(message);
    this.name = 'AppError';
    this.dependency = dependency;
    this.kind = kind;
    this.detail = detail;
  }

  get status(): number {
    return STATUS[this.kind];
  }

  get retryable(): boolean {
    return RETRYABLE[this.kind];
  }

  /** Exactly what a client receives. Nothing else about the error escapes. */
  toBody(): { error: string; kind: AppErrorKind; dependency: Dependency; retryable: boolean } {
    return {
      error: this.message,
      kind: this.kind,
      dependency: this.dependency,
      retryable: this.retryable,
    };
  }
}

/**
 * The sentences themselves.
 *
 * Written to answer the only two questions a person actually has: *is this my
 * fault*, and *what do I do now*. "An error occurred" answers neither, and
 * "ECONNREFUSED 127.0.0.1:54321" answers them for the wrong person.
 *
 * They name the dependency in ordinary words — "the AI provider", not
 * "anthropic" — because which vendor is behind a model is not something a user
 * of this app has agreed to care about.
 */
const MESSAGES: Record<Dependency, Partial<Record<AppErrorKind, string>>> = {
  database: {
    unreachable: 'Cannot reach the database right now. This is usually brief — try again shortly.',
    upstream: 'The database returned an error. Your last action may not have been saved.',
    unauthorised: 'The database rejected our credentials. An administrator needs to look at this.',
    unknown: 'Something went wrong reading your data. This has been logged.',
  },
  provider: {
    unauthorised:
      'The AI provider rejected this deployment’s API key. An administrator needs to update it.',
    exhausted:
      'The AI provider account is out of credit. An administrator needs to top it up — retrying will not help.',
    rate_limited: 'The AI provider is rate limiting us. Wait a moment and try again.',
    unreachable: 'Cannot reach the AI provider. Try again shortly.',
    upstream: 'The AI provider had an internal error. Try again shortly.',
    unconfigured: 'No AI provider is configured on this deployment.',
    invalid:
      'That conversation is too long for this model. Start a new one, or pick a larger model.',
    unknown: 'The AI provider failed in an unexpected way. This has been logged.',
  },
  storage: {
    unconfigured: 'File uploads are not configured on this deployment.',
    unauthorised: 'File storage rejected our credentials. An administrator needs to look at this.',
    unreachable: 'Cannot reach file storage. Try again shortly.',
    upstream: 'File storage returned an error. Your file was not saved.',
    unknown: 'Something went wrong with that file. This has been logged.',
  },
  email: {
    unconfigured: 'Email is not configured on this deployment, so no message was sent.',
    unauthorised: 'The email service rejected our credentials.',
    rate_limited: 'The email service is rate limiting us.',
    unreachable: 'Cannot reach the email service.',
    upstream: 'The email service returned an error.',
    unknown: 'The email could not be sent.',
  },
  config: {
    unconfigured: 'This deployment is missing required configuration.',
    unknown: 'This deployment is misconfigured.',
  },
};

/**
 * Fallbacks for combinations no dependency bothers to name — `database` has no
 * meaningful `exhausted`, `config` has no `rate_limited`.
 *
 * Keyed by KIND, not by dependency, and that is the whole point. The first
 * version fell back to the dependency's `unknown` sentence, which says "try
 * again shortly" — while `unknown` is deliberately NOT retryable. Eight
 * combinations therefore told a user to retry something the code would refuse
 * to retry. Caught by the test that cross-checks the two, not by reading.
 *
 * Each sentence here agrees with RETRYABLE above by construction.
 */
const KIND_DEFAULTS: Record<AppErrorKind, string> = {
  unauthorised:
    'A credential this deployment relies on was rejected. An administrator needs to look at this.',
  unconfigured: 'That feature is not configured on this deployment.',
  exhausted: 'A service this deployment relies on has run out of capacity. Retrying will not help.',
  rate_limited: 'Too many requests just now. Wait a moment and try again.',
  unreachable: 'Cannot reach a service this depends on. Try again shortly.',
  upstream: 'A service this depends on returned an error. Try again shortly.',
  invalid: 'That request was not valid.',
  // Deliberately does NOT invite a retry: `unknown` is not retryable, because
  // looping on a failure we cannot classify is how one bad request becomes ten.
  unknown: 'Something went wrong. This has been logged.',
};

export function messageFor(dependency: Dependency, kind: AppErrorKind): string {
  return MESSAGES[dependency][kind] ?? KIND_DEFAULTS[kind];
}

export function appError(dependency: Dependency, kind: AppErrorKind, detail?: string): AppError {
  return new AppError(dependency, kind, messageFor(dependency, kind), detail);
}

/**
 * Turns anything thrown into an `AppError`.
 *
 * The important branch is the last one. An unrecognised error becomes
 * `unknown`, and **its own message is discarded** rather than passed through:
 * an arbitrary `Error` from a library is written for whoever wrote the library
 * and routinely contains a path, a hostname or a query. Preserving it "for
 * debugging" is exactly how internals reach users.
 */
export function toAppError(err: unknown, dependency: Dependency): AppError {
  if (err instanceof AppError) return err;

  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  // Shapes, not vendor-specific codes: these come out of fetch, undici, node
  // and half a dozen SDKs, and they all mean the same thing to a user.
  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('socket hang up')
  ) {
    return new AppError(dependency, 'unreachable', messageFor(dependency, 'unreachable'), raw);
  }

  // "timed out" and "timeout" are both common, and the SDKs disagree about
  // which they use — matching only one classified half of all timeouts as
  // `unknown`, which is also the half that is not retryable. Found by a test
  // whose own message happened to use the other phrasing.
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborted') ||
    lower.includes('abort')
  ) {
    return new AppError(dependency, 'unreachable', messageFor(dependency, 'unreachable'), raw);
  }

  return new AppError(dependency, 'unknown', messageFor(dependency, 'unknown'), raw);
}

/** Maps a `ProviderError` kind onto this taxonomy, so the two do not diverge. */
export function fromProviderKind(
  kind: 'auth' | 'quota' | 'rate_limit' | 'context_length' | 'network' | 'provider' | 'unknown',
): AppErrorKind {
  switch (kind) {
    case 'auth':
      return 'unauthorised';
    case 'quota':
      return 'exhausted';
    case 'rate_limit':
      return 'rate_limited';
    case 'context_length':
      return 'invalid';
    case 'network':
      return 'unreachable';
    case 'provider':
      return 'upstream';
    default:
      return 'unknown';
  }
}

/**
 * Strings that must never appear in a message shown to a user.
 *
 * Exported so the test asserts against the same list the code is written
 * against, rather than a second copy that can drift.
 */
export const FORBIDDEN_IN_USER_MESSAGES: readonly string[] = [
  'sk-ant-',
  'sk-proj-',
  'sb_secret_',
  'ENCRYPTION_MASTER_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'R2_SECRET_ACCESS_KEY',
  'RESEND_API_KEY',
  'postgres://',
  'postgresql://',
  'supabase.co',
  'r2.cloudflarestorage.com',
  '/Users/',
  '/home/',
  'node_modules',
  'at Object.',
  'Error:',
  'stack',
];
