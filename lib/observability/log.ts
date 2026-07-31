import 'server-only';

import { randomUUID } from 'node:crypto';

/**
 * One log shape for every API route.
 *
 * Today each route logs in its own voice — `console.error('[api/chat] stream
 * error:', err)` next to `console.error('[uploads/presign] failed:', err)` —
 * which is fine to read one at a time and impossible to search. Railway's log
 * view has no idea those are the same kind of event.
 *
 * ## Why redaction is structural, not a filter
 *
 * The obvious design is `log(message, data)` with a scrubber that strips
 * secrets from `data` on the way out. That fails the first time someone
 * interpolates a token into `message`, and it fails silently.
 *
 * Instead: **the payload is a fixed set of typed fields.** There is no
 * free-form object to hide a secret in, because there is nowhere to put one.
 * Adding a field is a deliberate edit to `LogFields` below, which is where a
 * reviewer will see it. The scrubber still runs — belt and braces — but it is
 * the second line, not the first.
 *
 * ## What is deliberately absent
 *
 * No message body, no prompt text, no completion text, no email address, no IP.
 * A chat application's logs are the one place the entire private contents of
 * every conversation could accumulate, and "we only log it on errors" is how
 * that happens. Errors are where the interesting text is.
 */

export type Outcome = 'ok' | 'client_error' | 'server_error' | 'refused';

/**
 * Every field that may be logged. This list IS the redaction policy.
 *
 * Nothing here can carry user content: ids are opaque, counts are numbers, and
 * `detail` is the one free string — reserved for our own error text, never for
 * anything a user or a provider sent.
 */
export type LogFields = {
  /** Correlates the lines belonging to one request. */
  requestId: string;
  route: string;
  method: string;
  status: number;
  outcome: Outcome;
  durationMs: number;
  /** Opaque UUID. Never an email — that is personal data with no debugging value. */
  userId?: string;
  /** Which dependency was involved, when one was. */
  dependency?: string;
  /** Our own error classification, never a vendor message. */
  kind?: string;
  /** Model *identifier*, never prompt or completion text. */
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  attempts?: number;
  /** Our own diagnostic string. Scrubbed regardless. */
  detail?: string;
};

/**
 * Patterns scrubbed from `detail` before it is written.
 *
 * The field is already meant to hold only our own text. This exists because
 * "meant to" is not a guarantee: `detail` is frequently an upstream error
 * message, and upstream messages have been observed to quote the request —
 * including the credential that was rejected.
 */
const REDACTIONS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /sk-ant-[A-Za-z0-9_-]{6,}/g, replacement: 'sk-ant-[redacted]' },
  { pattern: /sk-proj-[A-Za-z0-9_-]{6,}/g, replacement: 'sk-proj-[redacted]' },
  { pattern: /sb_secret_[A-Za-z0-9_-]{6,}/g, replacement: 'sb_secret_[redacted]' },
  { pattern: /sb_publishable_[A-Za-z0-9_-]{6,}/g, replacement: 'sb_publishable_[redacted]' },
  { pattern: /re_[A-Za-z0-9]{12,}/g, replacement: 're_[redacted]' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA[redacted]' },
  {
    pattern: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
    replacement: '[jwt redacted]',
  },
  // Connection strings: the password is between the colon and the at-sign.
  { pattern: /(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, replacement: '$1[redacted]@' },
  // Anything shaped like an email, wherever it came from.
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[email redacted]' },
  // Absolute paths name the deployment's filesystem and the developer.
  { pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g, replacement: '/[path redacted]' },
  // A v1.iv.tag.ciphertext blob is an encrypted provider key.
  {
    pattern: /v1\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
    replacement: 'v1.[redacted]',
  },
];

/** Exported so the test scrubs with the same list the logger writes with. */
export function redact(value: string): string {
  let out = value;
  for (const { pattern, replacement } of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  // Long unbroken high-entropy runs are the shape of a credential nobody has
  // written a pattern for yet. Truncating loses nothing a human needed.
  return out.replace(/[A-Za-z0-9_-]{60,}/g, (m) => `${m.slice(0, 8)}…[truncated ${m.length}]`);
}

export function newRequestId(): string {
  return randomUUID();
}

/** Status → outcome, so the classification cannot drift between routes. */
export function outcomeFor(status: number): Outcome {
  if (status === 429 || status === 403) return 'refused';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  return 'ok';
}

/**
 * Writes one line of JSON.
 *
 * JSON rather than a formatted string because the consumer is a log search, not
 * a person reading a terminal — and a person can still read this one.
 *
 * Server errors go to stderr and everything else to stdout, so a platform that
 * separates the two (Railway does) surfaces failures without a filter.
 */
export function logRequest(fields: LogFields): void {
  const line: Record<string, unknown> = {
    at: new Date().toISOString(),
    ...fields,
  };

  if (typeof line.detail === 'string') line.detail = redact(line.detail);

  // Undefined keys would otherwise serialise as absent-but-noisy in some
  // aggregators; dropping them keeps every line the same shape.
  for (const key of Object.keys(line)) {
    if (line[key] === undefined) delete line[key];
  }

  const serialised = JSON.stringify(line);

  if (fields.outcome === 'server_error') console.error(serialised);
  else console.log(serialised);
}

/**
 * What a handler can report back about itself while it runs.
 *
 * The user id is not known until the handler has authenticated, which is inside
 * the wrapper — so it cannot be a parameter. A mutable context is the least
 * ceremony that still gets it into the log line.
 */
export type RequestContext = {
  requestId: string;
  userId?: string;
  dependency?: string;
  kind?: string;
};

/**
 * Times a request and logs exactly one line for it.
 *
 * Returns the handler's response untouched. The `requestId` is attached as a
 * response header so a user reporting "it failed at 14:02" can be matched to a
 * log line without guessing.
 */
export async function withRequestLog(
  context: { route: string; method: string; userId?: string },
  handler: (ctx: RequestContext) => Promise<Response>,
): Promise<Response> {
  const requestId = newRequestId();
  const started = Date.now();
  const reported: RequestContext = { requestId, userId: context.userId };

  try {
    const response = await handler(reported);
    logRequest({
      requestId,
      route: context.route,
      method: context.method,
      status: response.status,
      outcome: outcomeFor(response.status),
      durationMs: Date.now() - started,
      userId: reported.userId ?? context.userId,
      dependency: reported.dependency,
      kind: reported.kind,
    });

    response.headers.set('x-request-id', requestId);
    return response;
  } catch (err) {
    // A throw that reaches here is a bug, not a handled failure — logged as a
    // server error with the message scrubbed, then rethrown so the framework
    // still produces its own response.
    logRequest({
      requestId,
      route: context.route,
      method: context.method,
      status: 500,
      outcome: 'server_error',
      durationMs: Date.now() - started,
      userId: reported.userId ?? context.userId,
      dependency: reported.dependency,
      kind: reported.kind,
      detail: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
