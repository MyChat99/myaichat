import 'server-only';

import { createHmac } from 'node:crypto';

import { createAdminClient } from '@/lib/db/admin';

/**
 * Failed-attempt throttling for password entry.
 *
 * Two things are being defended here and they need different shapes:
 *
 *  - **Credential stuffing against one account** — many passwords, one email.
 *    Countered by locking that identifier after a handful of failures.
 *  - **Password spraying** — one common password, many emails. A per-account
 *    counter never trips, because each account sees a single failure. Countered
 *    by a second, looser counter keyed on the client IP.
 *
 * State lives in Postgres rather than in a module-level Map. An in-memory
 * counter is reset by every deploy and is not shared between instances, which
 * makes it exactly as strong as the attacker's willingness to wait for a
 * restart. The cost is one indexed query per login attempt.
 *
 * Identifiers are HMACed with the master key before storage — see the migration
 * for why the table must not become an email list.
 */

const WINDOW_MINUTES = 15;

/** Per-account. Deliberately low: a human who has failed five times is stuck. */
const MAX_PER_IDENTIFIER = 5;

/**
 * Per-IP. Deliberately high, because one office, one household or one mobile
 * carrier NAT can legitimately share an address. It exists to make spraying
 * expensive, not to stop a shared network from logging in.
 */
const MAX_PER_IP = 30;

export type ThrottleKind = 'login' | 'reauth';

export type ThrottleResult = {
  allowed: boolean;
  /** Seconds until the oldest counted failure ages out of the window. */
  retryAfterSeconds: number;
};

const ALLOWED: ThrottleResult = { allowed: true, retryAfterSeconds: 0 };

function hashIdentifier(value: string): string {
  const secret = process.env.ENCRYPTION_MASTER_KEY;
  if (!secret) {
    throw new Error('ENCRYPTION_MASTER_KEY is not set; refusing to store an unhashed identifier.');
  }
  return createHmac('sha256', Buffer.from(secret, 'base64')).update(value).digest('base64url');
}

/** `email:<hmac>` and `ip:<hmac>` share one column but can never collide. */
function identifierKey(email: string): string {
  return `email:${hashIdentifier(email.trim().toLowerCase())}`;
}

function ipKey(ip: string): string {
  return `ip:${hashIdentifier(ip)}`;
}

/**
 * The client address, as far as it can be trusted.
 *
 * `x-forwarded-for` is attacker-controlled unless a proxy overwrites it. Railway
 * does overwrite it, so the leftmost entry is the real client there — but on a
 * deployment without a trusted proxy this is spoofable, which is precisely why
 * the IP counter is the loose one and the per-account counter carries the real
 * weight. A spoofed IP buys an attacker nothing against the account lock.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

async function countFailures(identifier: string, kind: ThrottleKind, since: string) {
  const db = createAdminClient();
  const { data } = await db
    .from('auth_attempts')
    .select('created_at')
    .eq('identifier', identifier)
    .eq('kind', kind)
    .eq('succeeded', false)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  return data ?? [];
}

function retryAfter(oldest: string | undefined): number {
  if (!oldest) return WINDOW_MINUTES * 60;
  const elapsed = (Date.now() - new Date(oldest).getTime()) / 1000;
  return Math.max(1, Math.ceil(WINDOW_MINUTES * 60 - elapsed));
}

/**
 * Checked BEFORE the password is verified, so a locked account never reaches
 * the auth provider at all.
 */
export async function checkThrottle(
  email: string,
  ip: string,
  kind: ThrottleKind = 'login',
): Promise<ThrottleResult> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  const [byEmail, byIp] = await Promise.all([
    countFailures(identifierKey(email), kind, since),
    countFailures(ipKey(ip), kind, since),
  ]);

  if (byEmail.length >= MAX_PER_IDENTIFIER) {
    return { allowed: false, retryAfterSeconds: retryAfter(byEmail[0]?.created_at) };
  }

  if (byIp.length >= MAX_PER_IP) {
    return { allowed: false, retryAfterSeconds: retryAfter(byIp[0]?.created_at) };
  }

  return ALLOWED;
}

/**
 * Records the outcome. A success clears that account's failures so a user who
 * fumbles twice and then succeeds does not carry a nearly-full counter around
 * for the rest of the window.
 *
 * The IP counter is NOT cleared on success: one valid login should not launder
 * away a spray from the same address.
 */
export async function recordAttempt(
  email: string,
  ip: string,
  kind: ThrottleKind,
  succeeded: boolean,
): Promise<void> {
  const db = createAdminClient();
  const emailKey = identifierKey(email);

  if (succeeded) {
    await db.from('auth_attempts').delete().eq('identifier', emailKey).eq('kind', kind);
    // Opportunistic housekeeping, on the rare path rather than the hot one.
    await db.rpc('prune_auth_attempts');
    return;
  }

  await db.from('auth_attempts').insert([
    { identifier: emailKey, kind, succeeded: false },
    { identifier: ipKey(ip), kind, succeeded: false },
  ]);
}

/**
 * Removes every attempt recorded for one email and one IP.
 *
 * Exists for `verify:security`, which must clean up after itself without a
 * blanket delete by timestamp — that would clear other users' recent failures
 * and quietly disarm the throttle for anyone under attack while the test ran.
 */
export async function clearAttemptsFor(email: string, ip: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from('auth_attempts')
    .delete()
    .in('identifier', [identifierKey(email), ipKey(ip)]);
}

/** Exported for tests, so the numbers are asserted rather than re-typed. */
export const THROTTLE_LIMITS = {
  windowMinutes: WINDOW_MINUTES,
  maxPerIdentifier: MAX_PER_IDENTIFIER,
  maxPerIp: MAX_PER_IP,
} as const;
