import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Idle-session policy.
 *
 * Signs out a session that has gone untouched for longer than
 * `system_settings.session_idle_timeout_minutes`. **0 disables it, and 0 is the
 * default** — shipping this changes nothing until an administrator turns it on.
 * That is deliberate: this code runs in the proxy, on the auth path, where a
 * mistake logs out every user at once.
 *
 * ## What it actually defends against, and what it does not
 *
 * The marker is a cookie. The browser holds it, so anyone who controls the
 * browser controls it. This is **not** a defence against an attacker who has
 * already exfiltrated your cookie jar — they can drop the marker and start the
 * clock again.
 *
 * What it does defend: the unlocked laptop, the shared machine, the session
 * left open on a conference-room screen. Someone who walks up to a signed-in
 * browser after the idle window has to know the password to continue. That is
 * the realistic case, and it is worth closing.
 *
 * The marker is HMAC-signed so it cannot be *edited* — an attacker can delete
 * it but cannot forward-date it, which is what stops the obvious bypass of
 * setting the timestamp to now and keeping a stale session alive indefinitely.
 *
 * ⚠️ This is an APPLICATION policy. Signing out clears our cookie; it does not
 * revoke the Supabase refresh token, which remains valid until it expires on
 * its own. See ISSUE-028 — that is a separate gap with a separate fix.
 */

export const IDLE_COOKIE = 'myaichat-seen';

/** Below this, re-stamping every request would cost more than it is worth. */
export const RESTAMP_AFTER_SECONDS = 60;

export type IdleVerdict = 'disabled' | 'fresh' | 'expired' | 'unmarked';

function key(): Buffer | null {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) return null;
  try {
    return Buffer.from(raw, 'base64');
  } catch {
    return null;
  }
}

/** `<millis>.<hmac>` — opaque to the browser, unforgeable without the key. */
export function signMarker(nowMs: number): string | null {
  const k = key();
  if (!k) return null;
  const stamp = String(nowMs);
  const mac = createHmac('sha256', k).update(stamp).digest('base64url');
  return `${stamp}.${mac}`;
}

/**
 * Returns the signed timestamp, or null if the value is absent, malformed or
 * has been tampered with. A bad signature is treated exactly like a missing
 * marker — there is nothing to gain from distinguishing them.
 */
export function readMarker(value: string | undefined): number | null {
  if (!value) return null;
  const k = key();
  if (!k) return null;

  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;

  const stamp = value.slice(0, dot);
  const provided = value.slice(dot + 1);
  const ms = Number(stamp);
  if (!Number.isFinite(ms) || ms <= 0) return null;

  const expected = createHmac('sha256', k).update(stamp).digest('base64url');

  // Constant-time compare. Overkill for a timestamp, but the alternative is
  // deciding case by case which comparisons deserve it, and getting that wrong
  // once is worse than always paying for it.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? ms : null;
}

/**
 * The policy decision, as a pure function so it can be tested without a browser,
 * a request or a database.
 *
 * `unmarked` deliberately does NOT mean expired. On the request after this
 * feature is enabled — or after a deploy, or for anyone whose cookie was
 * cleared — there is no marker yet, and treating that as expiry would sign out
 * every user the moment an admin flips the setting on.
 */
export function idleVerdict(
  lastSeenMs: number | null,
  timeoutMinutes: number,
  nowMs: number,
): IdleVerdict {
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) return 'disabled';
  if (lastSeenMs === null) return 'unmarked';

  // A marker from the future means a clock change or a forgery that somehow
  // verified. Treat it as fresh and let the next request re-stamp it, rather
  // than signing someone out over a daylight-saving shift.
  if (lastSeenMs > nowMs) return 'fresh';

  const idleMs = nowMs - lastSeenMs;
  return idleMs > timeoutMinutes * 60_000 ? 'expired' : 'fresh';
}

/** True when the marker is old enough that re-writing it is worth the header. */
export function shouldRestamp(lastSeenMs: number | null, nowMs: number): boolean {
  if (lastSeenMs === null) return true;
  return nowMs - lastSeenMs >= RESTAMP_AFTER_SECONDS * 1000;
}
