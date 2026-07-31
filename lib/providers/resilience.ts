import type { ProviderErrorKind } from './types';

/**
 * Timeouts and retry policy for outbound provider calls.
 *
 * ## The rule that shapes all of this
 *
 * **A stream may only be retried before its first token.**
 *
 * Once any text has reached the client, re-running the request produces a
 * second answer appended to a partial first one. The user sees the model
 * stammer, and the bill is charged twice. Retrying "the request" is safe;
 * retrying "the stream" is not, and the distinction is invisible unless it is
 * written down — so the retry helper below takes an explicit
 * `hasEmittedOutput` guard rather than trusting the caller to remember.
 *
 * ## Why the SDKs' own retries are turned off
 *
 * Both vendor SDKs retry by default, with different counts, different backoff
 * and different opinions about which statuses qualify. Leaving them on means
 * the effective policy depends on which model a user picked, and a "3 attempts"
 * setting here would really be 3 × the SDK's own. One policy, applied in one
 * place, is testable; two stacked policies are a guess.
 */

/**
 * How long a single provider request may take before it is abandoned.
 *
 * The route's `maxDuration` is 300s. Without a client timeout a hung provider
 * holds a Node handle for all of it, and the user gets a spinner that never
 * resolves. Ninety seconds is comfortably longer than a slow legitimate
 * completion and far shorter than "forever".
 */
export const REQUEST_TIMEOUT_MS = 90_000;

/**
 * A much shorter ceiling for health checks.
 *
 * `REQUEST_TIMEOUT_MS` is sized for a slow *completion*. A health check is a
 * one-token generation, and it is awaited during a page render — the admin
 * overview. Inheriting 90 seconds meant a provider that hangs (rather than
 * refusing) blocked for a minute and a half the very page you would open to
 * find out a provider was down.
 *
 * Eight seconds is far longer than a healthy one-token round trip and short
 * enough that a hung provider reads as "down" rather than "loading".
 */
export const HEALTH_TIMEOUT_MS = 8_000;

/** Attempts INCLUDING the first. 3 means one try plus two retries. */
export const MAX_ATTEMPTS = 3;

const BASE_DELAY_MS = 400;
const MAX_DELAY_MS = 8_000;

/**
 * Which failures are worth trying again.
 *
 * Deliberately an allow-list. A default of "retry unless known-permanent" turns
 * every unclassified failure into three failures, and the ones we cannot
 * classify are exactly the ones we should not multiply.
 *
 * `rate_limit` is included because backing off is the correct response to it —
 * that is what the status means. `quota` is excluded even though it arrives on
 * a similar status: an empty balance does not refill in 400ms, and retrying
 * only wastes the user's time.
 */
export function isRetryableKind(kind: ProviderErrorKind): boolean {
  return kind === 'network' || kind === 'provider' || kind === 'rate_limit';
}

/**
 * Exponential backoff with full jitter.
 *
 * Jitter is not decoration. Without it, every client that failed against the
 * same provider outage retries at the same instant, and the retry storm keeps
 * the provider down — the thing we are waiting to recover from. Full jitter
 * (random between 0 and the cap) is the variant that spreads load best.
 *
 * `random` is injectable so the test can assert bounds deterministically
 * instead of asserting nothing and hoping.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
  return Math.round(random() * exponential);
}

export type RetryOutcome<T> = { value: T; attempts: number };

/**
 * Runs `attempt`, retrying transient failures with backoff.
 *
 * `hasEmittedOutput` is checked before every retry. A caller that has already
 * streamed anything gets the error, not another attempt — see the note at the
 * top of this file.
 */
export async function withRetry<T>(
  attempt: (attemptNumber: number) => Promise<T>,
  options: {
    isRetryable: (err: unknown) => boolean;
    hasEmittedOutput: () => boolean;
    maxAttempts?: number;
    onRetry?: (info: { attempt: number; delayMs: number; err: unknown }) => void;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  },
): Promise<RetryOutcome<T>> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;

  for (let n = 1; n <= maxAttempts; n++) {
    try {
      return { value: await attempt(n), attempts: n };
    } catch (err) {
      lastError = err;

      const isLast = n === maxAttempts;
      if (isLast || !options.isRetryable(err) || options.hasEmittedOutput()) throw err;

      const delayMs = backoffMs(n, options.random);
      options.onRetry?.({ attempt: n, delayMs, err });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Races a promise against a deadline.
 *
 * The rejected value is a plain Error with a message the `toAppError` mapper
 * already classifies as `unreachable` — so a timeout is reported the same way
 * as any other failure to reach a dependency, rather than as its own special
 * case that every caller has to know about.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  /**
   * The timer is CLEARED on settle, not `unref`ed.
   *
   * `unref()` was the first attempt and it silently broke the deadline: an
   * unref'd timer does not hold the event loop, and a pending promise does not
   * either — so a process whose only remaining work was "wait for the deadline
   * on a hung call" exited cleanly before the timer ever fired. The test caught
   * it by ending mid-run with no summary.
   *
   * Clearing on settle gets both properties: the deadline genuinely fires while
   * the call is outstanding, and a fast call leaves nothing behind to delay
   * process exit.
   */
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
