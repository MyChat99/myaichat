/**
 * Retry policy and outbound timeouts.
 *
 * The property that matters most here cannot be observed from the outside: a
 * stream must never be retried once it has emitted text, because the user would
 * see a second answer appended to a partial first one and be billed twice. It
 * is asserted directly, with a fake attempt function that records what happened.
 *
 * Credential-free and deterministic — `sleep` and `random` are injected, so
 * this asserts real bounds instead of waiting on wall-clock time.
 *
 *   npm run verify:resilience
 */
import { readFileSync } from 'node:fs';

import {
  HEALTH_TIMEOUT_MS,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  withDeadline,
  backoffMs,
  isRetryableKind,
  withRetry,
} from '../lib/providers/resilience';
import { ProviderError, type ProviderErrorKind } from '../lib/providers/types';

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

/** No real waiting: the point is the decision, not the delay. */
const instant = async () => {};

function providerError(kind: ProviderErrorKind) {
  return new ProviderError(kind, `simulated ${kind}`, isRetryableKind(kind));
}

// ─────────────────────────────────────────────────── which kinds retry

function verifyPredicate() {
  section('Which failures are retried');

  const retry: ProviderErrorKind[] = ['network', 'provider', 'rate_limit'];
  const never: ProviderErrorKind[] = ['auth', 'quota', 'context_length', 'unknown'];

  for (const kind of retry) check(`${kind} retries`, isRetryableKind(kind));
  for (const kind of never) check(`${kind} does NOT retry`, !isRetryableKind(kind));

  console.log('');

  // The two that look similar and are not. Both can arrive on a 429-ish path;
  // backing off fixes one and wastes the user's time on the other.
  check(
    'rate_limit retries but quota does not',
    isRetryableKind('rate_limit') && !isRetryableKind('quota'),
  );

  // An unclassified failure must not be multiplied — the ones we cannot
  // classify are exactly the ones not to try three times.
  check('unknown is not retried', !isRetryableKind('unknown'));

  // A rejected key never fixes itself inside a request.
  check('auth is not retried', !isRetryableKind('auth'));
}

// ─────────────────────────────────────────────────── backoff

function verifyBackoff() {
  section('Backoff grows, is capped, and is jittered');

  // With random() pinned to 1 the value is the ceiling for that attempt.
  const ceiling = (attempt: number) => backoffMs(attempt, () => 1);

  check('attempt 1 ceiling is 400ms', ceiling(1) === 400, String(ceiling(1)));
  check('attempt 2 doubles', ceiling(2) === 800, String(ceiling(2)));
  check('attempt 3 doubles again', ceiling(3) === 1600, String(ceiling(3)));
  check('it is capped', ceiling(20) === 8000, String(ceiling(20)));

  check('random() = 0 yields no delay', backoffMs(3, () => 0) === 0);

  // Full jitter: every value must land inside [0, ceiling]. Without jitter,
  // every client that failed against one outage retries at the same instant and
  // keeps the provider down.
  let allInRange = true;
  const distinct = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const value = backoffMs(3);
    if (value < 0 || value > 1600) allInRange = false;
    distinct.add(value);
  }
  check('200 samples all fall within [0, ceiling]', allInRange);
  check(
    'and they are actually jittered, not constant',
    distinct.size > 20,
    `${distinct.size} distinct`,
  );

  check(`${MAX_ATTEMPTS} attempts total is bounded`, MAX_ATTEMPTS >= 2 && MAX_ATTEMPTS <= 5);
}

// ─────────────────────────────────────────────────── the retry loop

async function verifyRetryLoop() {
  section('The retry loop');

  // Succeeds first time: no retry, no delay.
  {
    let calls = 0;
    const { attempts } = await withRetry(
      async () => {
        calls++;
        return 'ok';
      },
      { isRetryable: () => true, hasEmittedOutput: () => false, sleep: instant },
    );
    check('a success is not retried', calls === 1 && attempts === 1);
  }

  // Transient, then success.
  {
    let calls = 0;
    const { value, attempts } = await withRetry(
      async (n) => {
        calls++;
        if (n < 3) throw providerError('network');
        return 'recovered';
      },
      {
        isRetryable: (e) => e instanceof ProviderError && isRetryableKind(e.kind),
        hasEmittedOutput: () => false,
        sleep: instant,
      },
    );
    check(
      'a transient failure recovers',
      value === 'recovered' && attempts === 3,
      `${calls} calls`,
    );
  }

  // Non-retryable: exactly one attempt.
  {
    let calls = 0;
    let threw = false;
    try {
      await withRetry(
        async () => {
          calls++;
          throw providerError('auth');
        },
        {
          isRetryable: (e) => e instanceof ProviderError && isRetryableKind(e.kind),
          hasEmittedOutput: () => false,
          sleep: instant,
        },
      );
    } catch {
      threw = true;
    }
    check('a rejected key is tried once and only once', threw && calls === 1, `${calls} calls`);
  }

  // Exhaustion: bounded, and the original error survives.
  {
    let calls = 0;
    let caught: unknown;
    try {
      await withRetry(
        async () => {
          calls++;
          throw providerError('provider');
        },
        {
          isRetryable: () => true,
          hasEmittedOutput: () => false,
          sleep: instant,
        },
      );
    } catch (err) {
      caught = err;
    }
    check(`it stops after ${MAX_ATTEMPTS} attempts`, calls === MAX_ATTEMPTS, `${calls} calls`);
    check('and rethrows the provider error', caught instanceof ProviderError);
  }

  console.log('');

  /**
   * The one that matters.
   *
   * A stream that has already sent text must NOT be retried — the user would
   * get a second answer appended to a partial first one, and the exchange would
   * be billed twice. This is invisible from outside, so it is asserted here.
   */
  {
    let calls = 0;
    let emitted = '';
    let threw = false;
    try {
      await withRetry(
        async () => {
          calls++;
          emitted += 'partial answer ';
          throw providerError('network'); // retryable in isolation
        },
        {
          isRetryable: () => true,
          hasEmittedOutput: () => emitted.length > 0,
          sleep: instant,
        },
      );
    } catch {
      threw = true;
    }
    check(
      'a stream that already emitted text is NOT retried',
      threw && calls === 1,
      `${calls} attempts — the user would have seen the answer twice`,
    );
  }

  // The same failure BEFORE any output is retried, which is the whole point of
  // distinguishing the two.
  {
    let calls = 0;
    const emitted = '';
    const { attempts } = await withRetry(
      async (n) => {
        calls++;
        if (n === 1) throw providerError('network');
        return 'ok';
      },
      { isRetryable: () => true, hasEmittedOutput: () => emitted.length > 0, sleep: instant },
    );
    check('the same failure BEFORE output is retried', attempts === 2, `${calls} calls`);
  }

  // A user pressing Stop must not be answered with a retry.
  {
    let calls = 0;
    let threw = false;
    const aborted = { aborted: true };
    try {
      await withRetry(
        async () => {
          calls++;
          throw providerError('network');
        },
        {
          isRetryable: () => !aborted.aborted,
          hasEmittedOutput: () => false,
          sleep: instant,
        },
      );
    } catch {
      threw = true;
    }
    check('an aborted request is not retried', threw && calls === 1, `${calls} calls`);
  }

  // Delays are reported so a slow retry is visible in a log rather than looking
  // like a hang.
  {
    const seen: number[] = [];
    try {
      await withRetry(
        async () => {
          throw providerError('provider');
        },
        {
          isRetryable: () => true,
          hasEmittedOutput: () => false,
          sleep: instant,
          random: () => 1,
          onRetry: ({ delayMs }) => seen.push(delayMs),
        },
      );
    } catch {
      /* expected */
    }
    check('each retry reports its delay', seen.length === MAX_ATTEMPTS - 1, JSON.stringify(seen));
    check(
      'and the delays increase',
      seen.every((d, i) => i === 0 || d > seen[i - 1]!),
      JSON.stringify(seen),
    );
  }
}

// ─────────────────────────────────────────────────── timeouts

function verifyTimeouts() {
  section('Outbound timeouts');

  check('a request timeout is set', REQUEST_TIMEOUT_MS > 0);
  check(
    'and is shorter than the route maxDuration',
    REQUEST_TIMEOUT_MS < 300_000,
    `${REQUEST_TIMEOUT_MS}ms vs 300000ms — a timeout longer than the route is no timeout`,
  );
  check('and is long enough for a slow completion', REQUEST_TIMEOUT_MS >= 30_000);

  // Both adapters must actually apply it. A constant nobody passes to the SDK
  // is a comment, not a timeout.
  for (const file of ['lib/providers/anthropic.ts', 'lib/providers/openai.ts']) {
    const source = readFileSync(file, 'utf8');
    check(
      `${file} passes the timeout to its client`,
      source.includes('timeout: REQUEST_TIMEOUT_MS'),
    );
    check(
      `  and disables the SDK's own retries`,
      source.includes('maxRetries: 0'),
      'two stacked retry policies make "3 attempts" mean 3 × whatever the SDK does',
    );
  }

  console.log('');

  /**
   * A health check is awaited during a PAGE RENDER. Inheriting the streaming
   * timeout meant a provider that hangs blocked the admin overview for ninety
   * seconds — the very page you would open to find out a provider was down.
   */
  check('health checks have their own, shorter ceiling', HEALTH_TIMEOUT_MS < REQUEST_TIMEOUT_MS);
  check(
    '  and it is short enough to sit inside a page render',
    HEALTH_TIMEOUT_MS <= 15_000,
    `${HEALTH_TIMEOUT_MS}ms — a dashboard that takes this long reads as broken`,
  );
  check(
    '  but long enough for a healthy one-token round trip',
    HEALTH_TIMEOUT_MS >= 3_000,
    `${HEALTH_TIMEOUT_MS}ms`,
  );

  const dashboard = readFileSync('lib/admin/dashboard.ts', 'utf8');
  check('the dashboard applies the health deadline', dashboard.includes('withDeadline('));
  check(
    '  rather than the streaming timeout',
    !dashboard.includes('REQUEST_TIMEOUT_MS'),
    'the overview would hang for 90s on a provider that hangs',
  );

  const route = readFileSync('app/api/chat/route.ts', 'utf8');
  check('the chat route uses withRetry', route.includes('withRetry('));
  check(
    '  and guards it with hasEmittedOutput',
    route.includes('hasEmittedOutput'),
    'without this guard a retry duplicates a partial answer',
  );
}

async function verifyDeadline() {
  section('withDeadline');

  const fast = await withDeadline(Promise.resolve('done'), 1_000, 'fast');
  check('a promise that resolves in time passes through', fast === 'done');

  let timedOut = false;
  let message = '';
  try {
    await withDeadline(new Promise(() => {}), 40, 'hung-provider');
  } catch (err) {
    timedOut = true;
    message = err instanceof Error ? err.message : String(err);
  }
  check('a promise that never settles rejects', timedOut);
  check('  and the message names the label', message.includes('hung-provider'), message);

  // The reason it rejects with a plain Error: `toAppError` already classifies
  // "timed out" as unreachable, so a deadline is reported exactly like any
  // other failure to reach a dependency rather than as a special case.
  const { toAppError } = await import('../lib/errors/app-error');
  check(
    'a timeout classifies as unreachable',
    toAppError(new Error(message), 'provider').kind === 'unreachable',
  );

  // A rejection must propagate, not be swallowed into a timeout.
  let sawOriginal = false;
  try {
    await withDeadline(Promise.reject(new Error('the real failure')), 1_000, 'x');
  } catch (err) {
    sawOriginal = err instanceof Error && err.message === 'the real failure';
  }
  check('an underlying rejection is not masked by the deadline', sawOriginal);
}

async function main() {
  console.log('Resilience — retries and timeouts');

  verifyPredicate();
  verifyBackoff();
  await verifyRetryLoop();
  await verifyDeadline();
  verifyTimeouts();

  console.log(
    failures === 0
      ? `\nAll ${checks} resilience checks passed.`
      : `\n${failures} of ${checks} resilience checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
