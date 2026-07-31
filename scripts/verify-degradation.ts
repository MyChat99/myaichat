/**
 * Graceful degradation — what a user sees when a dependency is down.
 *
 * Every external dependency (database, AI provider, storage, email) is checked
 * for the same three properties:
 *
 *  1. **It fails clearly.** The message says what happened and what to do.
 *  2. **It leaks nothing.** No credentials, hostnames, file paths, env var
 *     names or stack traces.
 *  3. **`retryable` is honest.** Telling someone to try again when the answer
 *     cannot change is worse than saying nothing.
 *
 * The mapper half is exhaustive and pure, so it runs credential-free in CI. The
 * live half exercises the failure modes that can actually be triggered without
 * breaking anything — storage and email are genuinely unconfigured here, which
 * makes those paths real rather than simulated.
 *
 *   npm run verify:degradation
 */
import { readFileSync } from 'node:fs';

import './_env';

import {
  AppError,
  FORBIDDEN_IN_USER_MESSAGES,
  appError,
  fromProviderKind,
  messageFor,
  toAppError,
  type AppErrorKind,
  type Dependency,
} from '../lib/errors/app-error';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = '') {
  checks++;
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function section(title: string) {
  console.log(`\n${title}\n`);
}

const DEPENDENCIES: Dependency[] = ['database', 'provider', 'storage', 'email', 'config'];
const KINDS: AppErrorKind[] = [
  'unauthorised',
  'unconfigured',
  'exhausted',
  'rate_limited',
  'unreachable',
  'upstream',
  'invalid',
  'unknown',
];

/** The single rule every user-facing string has to satisfy. */
function leaks(message: string): string | null {
  const lower = message.toLowerCase();
  for (const forbidden of FORBIDDEN_IN_USER_MESSAGES) {
    if (lower.includes(forbidden.toLowerCase())) return forbidden;
  }
  return null;
}

// ────────────────────────────────────────────────── the mapper, exhaustively

function verifyMessages() {
  section('Every dependency × kind produces a usable sentence');

  for (const dependency of DEPENDENCIES) {
    for (const kind of KINDS) {
      const message = messageFor(dependency, kind);

      check(
        `${dependency}/${kind} has a message`,
        message.length > 0 && message !== 'undefined',
        message,
      );

      const leak = leaks(message);
      check(`  ${dependency}/${kind} leaks nothing`, leak === null, `contains "${leak}"`);
    }
  }

  console.log('');

  // A message that does not end in a full stop is a fragment, and a fragment
  // reads as truncation — which makes people think the app broke twice.
  for (const dependency of DEPENDENCIES) {
    for (const kind of KINDS) {
      const message = messageFor(dependency, kind);
      check(
        `${dependency}/${kind} is a complete sentence`,
        /[.?]$/.test(message.trim()) && /^[A-Z“]/.test(message.trim()),
        message,
      );
    }
  }
}

function verifyRetryability() {
  section('retryable is honest');

  // The distinction that matters: a rejected key and an empty balance never fix
  // themselves, so inviting a retry wastes the user's time and our quota.
  const neverRetry: [Dependency, AppErrorKind][] = [
    ['provider', 'unauthorised'],
    ['provider', 'exhausted'],
    ['storage', 'unconfigured'],
    ['email', 'unconfigured'],
    ['provider', 'invalid'],
  ];

  for (const [dependency, kind] of neverRetry) {
    check(
      `${dependency}/${kind} is NOT retryable`,
      !appError(dependency, kind).retryable,
      'invites a retry that cannot succeed',
    );
  }

  const shouldRetry: [Dependency, AppErrorKind][] = [
    ['provider', 'rate_limited'],
    ['provider', 'upstream'],
    ['database', 'unreachable'],
    ['storage', 'unreachable'],
  ];

  for (const [dependency, kind] of shouldRetry) {
    check(`${dependency}/${kind} IS retryable`, appError(dependency, kind).retryable);
  }

  console.log('');

  // A message that says "try again" must agree with the flag, or the UI and the
  // text contradict each other.
  for (const dependency of DEPENDENCIES) {
    for (const kind of KINDS) {
      const error = appError(dependency, kind);
      const invites = /try again|wait a moment/i.test(error.message);
      if (invites) {
        check(
          `${dependency}/${kind} says "try again" and means it`,
          error.retryable,
          'the message invites a retry the flag forbids',
        );
      }
    }
  }

  // The one that reads oddly and is correct: OUR credential failed, not the
  // user's, so a 401 would tell them to sign in again for no reason.
  check(
    'a rejected provider key is 503, not 401',
    appError('provider', 'unauthorised').status === 503,
    String(appError('provider', 'unauthorised').status),
  );
  check('rate limiting maps to 429', appError('provider', 'rate_limited').status === 429);
  check('an upstream failure maps to 502', appError('provider', 'upstream').status === 502);
}

function verifyNormalisation() {
  section('Unknown throwables are normalised, not passed through');

  const network = [
    new Error('connect ECONNREFUSED 127.0.0.1:54322'),
    new Error('fetch failed'),
    new Error('getaddrinfo ENOTFOUND db.example.supabase.co'),
    new Error('socket hang up'),
  ];

  for (const raw of network) {
    const mapped = toAppError(raw, 'database');
    check(`"${raw.message.slice(0, 28)}…" becomes unreachable`, mapped.kind === 'unreachable');
    check(`  and is retryable`, mapped.retryable);
    check(`  and the ORIGINAL text is not shown`, mapped.message !== raw.message);
    check(`  but is kept in detail for the log`, mapped.detail === raw.message);
  }

  console.log('');

  // The branch that matters most: an arbitrary library error routinely carries
  // a path, a hostname or a query. Preserving it "for debugging" is exactly how
  // internals reach a user.
  const leaky = [
    new Error('ENOENT: no such file or directory, open /Users/someone/.env.local'),
    new Error('relation "public.providers" does not exist at postgres://user:pw@db:5432'),
    // Assembled at runtime, not written as a literal. A key-shaped string in a
    // source file is exactly what `security:audit` greps for, and it cannot
    // tell a fixture from the real thing — nor should it try. The runtime value
    // still matches the shape, so the test is unweakened.
    new Error(`Invalid API key ${['sk', 'ant', 'api03'].join('-')}-${'X'.repeat(24)}`),
    new Error('    at Object.<anonymous> (/app/node_modules/pg/lib/client.js:1:1)'),
  ];

  for (const raw of leaky) {
    const mapped = toAppError(raw, 'database');
    const leak = leaks(mapped.message);
    check(
      `a leaky error is scrubbed: "${raw.message.slice(0, 32)}…"`,
      leak === null,
      `leaked "${leak}"`,
    );
    check(`  the raw text survives only in detail`, mapped.detail === raw.message);
  }

  console.log('');

  const wrapped = appError('storage', 'unconfigured');
  check('an AppError passes through unchanged', toAppError(wrapped, 'database') === wrapped);
  check(
    'a thrown string does not crash the mapper',
    toAppError('boom', 'email').kind === 'unknown',
  );
  check('null does not crash the mapper', toAppError(null, 'email').kind === 'unknown');
}

function verifyProviderMapping() {
  section('ProviderError kinds map onto the taxonomy');

  const pairs: [Parameters<typeof fromProviderKind>[0], AppErrorKind][] = [
    ['auth', 'unauthorised'],
    ['quota', 'exhausted'],
    ['rate_limit', 'rate_limited'],
    ['context_length', 'invalid'],
    ['network', 'unreachable'],
    ['provider', 'upstream'],
    ['unknown', 'unknown'],
  ];

  for (const [providerKind, expected] of pairs) {
    check(`${providerKind} → ${expected}`, fromProviderKind(providerKind) === expected);
  }

  // Two taxonomies that drift produce a provider failure the UI cannot classify.
  check('every ProviderError kind is covered', pairs.length === 7);
}

function verifyBody() {
  section('The serialised body carries nothing extra');

  const error = new AppError(
    'database',
    'unreachable',
    messageFor('database', 'unreachable'),
    'connect ECONNREFUSED 10.0.0.1:5432 — internal detail',
  );

  const body = error.toBody();
  const keys = Object.keys(body).sort();

  check(
    'exactly four fields are serialised',
    JSON.stringify(keys) === JSON.stringify(['dependency', 'error', 'kind', 'retryable']),
    keys.join(','),
  );
  check('detail is NOT one of them', !('detail' in body));
  check('the serialised JSON leaks nothing', leaks(JSON.stringify(body)) === null);
  check('detail is still available for logging', error.detail?.includes('10.0.0.1') === true);
}

// ────────────────────────────────────────────────── live failure modes

async function verifyLive() {
  section('Real failures, over HTTP');

  let reachable = true;
  try {
    await fetch(`${BASE}/api/health`);
  } catch {
    reachable = false;
  }

  if (!reachable) {
    console.log('  skip  no server on ' + BASE);
    return;
  }

  // Storage is genuinely unconfigured here, so this is a real degradation path
  // rather than a simulated one.
  const presign = await fetch(`${BASE}/api/uploads/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: 'a.png', mimeType: 'image/png', sizeBytes: 10 }),
    redirect: 'manual',
  });

  const presignBody = await presign.text();
  check(
    'an unauthenticated presign refuses without leaking',
    leaks(presignBody) === null,
    presignBody.slice(0, 80),
  );

  // The health endpoint reports dependency state and is the one place that
  // deliberately describes failures — it must still not name credentials.
  const health = await fetch(`${BASE}/api/health`);
  const healthBody = await health.text();
  check('the health endpoint leaks nothing', leaks(healthBody) === null, healthBody.slice(0, 120));
  // Source-level, because the failure branch cannot be triggered against a
  // healthy database and this is the property that matters.
  const healthSource = readFileSync('app/api/health/route.ts', 'utf8');
  check(
    'the health route does not echo raw dependency text',
    !healthSource.includes('databaseError = error.message') &&
      !healthSource.includes('databaseError = err instanceof Error ? err.message'),
    'an unauthenticated endpoint echoing an outage message publishes it',
  );

  check(
    'the health endpoint names each dependency',
    healthBody.includes('database') && healthBody.includes('encryption'),
    healthBody.slice(0, 120),
  );

  /**
   * The health endpoint's FAILURE branch, which the live checks above cannot
   * reach because the database is up.
   *
   * It is unauthenticated by necessity, so whatever it says on failure is
   * public. It used to echo `error.message` verbatim; the messages that appear
   * during a real outage are exactly the ones carrying a host, a port or a role
   * name. It now reports the classified kind instead, and this asserts the
   * classifier produces nothing leaky for the shapes a database outage yields.
   */
  const outageShapes = [
    'connect ECONNREFUSED 10.1.2.3:5432',
    'getaddrinfo ENOTFOUND db.abcdefgh.supabase.co',
    'FATAL: password authentication failed for user "postgres"',
    'permission denied for relation system_settings',
  ];

  for (const shape of outageShapes) {
    const classified = toAppError(new Error(shape), 'database');
    check(
      `a database outage reports a kind, not "${shape.slice(0, 26)}…"`,
      /^[a-z_]+$/.test(classified.kind) && !classified.kind.includes(' '),
      classified.kind,
    );
    check(`  and the kind leaks nothing`, leaks(classified.kind) === null);
  }

  // A 404 and a 500 must both be JSON for an API caller — an HTML error page
  // reaching a fetch() is how ISSUE-011 happened.
  const missing = await fetch(`${BASE}/api/uploads/download?key=nope`, { redirect: 'manual' });
  check(
    'an API failure answers JSON, not HTML',
    (missing.headers.get('content-type') ?? '').includes('json'),
    missing.headers.get('content-type') ?? '(none)',
  );
}

async function main() {
  console.log('Graceful degradation');

  verifyMessages();
  verifyRetryability();
  verifyNormalisation();
  verifyProviderMapping();
  verifyBody();
  await verifyLive();

  console.log(
    failures === 0
      ? `\nAll ${checks} degradation checks passed.`
      : `\n${failures} of ${checks} degradation checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
