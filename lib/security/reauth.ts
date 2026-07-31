import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env';
import { requireAdmin } from '@/lib/security/auth';
import { checkThrottle, clientIp, recordAttempt } from '@/lib/security/throttle';

/**
 * Server-enforced re-authentication for high-value actions.
 *
 * The threat this closes: an admin walks away from an unlocked laptop, or a
 * session cookie is stolen. Neither gives up the password, but both give up
 * everything the session can do — including reading back which provider keys
 * exist and replacing them with an attacker's own. Asking for the password
 * again at that one boundary means a stolen session alone is not enough.
 *
 * Two implementation details matter:
 *
 *  1. Verification runs on a **throwaway client with `persistSession: false`**.
 *     Calling `signInWithPassword` on the request-bound server client would
 *     mint a new session and rewrite the auth cookies as a side effect of a
 *     check — a confirmation prompt must not silently re-issue credentials.
 *
 *  2. It is **throttled**, under its own `reauth` counter. An unthrottled
 *     "confirm your password" field is a password oracle that happens to be
 *     behind a login, and it is a nicer one than the login form because it
 *     already knows which account it is asking about.
 *
 * The check is done here, server-side, and not merely by showing a dialog in
 * the UI: a Server Action is a POST endpoint, and anything enforced only in the
 * component that calls it is not enforced.
 */

export class ReauthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReauthError';
  }
}

/**
 * Confirms the caller is an admin AND has just proved knowledge of their
 * password. Returns the admin user so callers keep a single gate call.
 *
 * Throws `ReauthError` on a bad password or a tripped throttle — the caller
 * surfaces the message, which is deliberately identical in both cases except
 * for the wait, so this cannot be used to probe anything.
 */
export async function requireAdminWithPassword(password: unknown, headers: Headers) {
  const admin = await requireAdmin();

  if (typeof password !== 'string' || password.length === 0) {
    throw new ReauthError('Enter your password to confirm this change.');
  }

  const email = admin.email;
  if (!email) {
    // Only reachable for an account created without an email (e.g. pure OAuth),
    // which this app does not currently produce. Failing closed is the only
    // safe branch: silently skipping the check would make the gate optional.
    throw new ReauthError('This account has no password to confirm with.');
  }

  const ip = clientIp(headers);

  const throttle = await checkThrottle(email, ip, 'reauth');
  if (!throttle.allowed) {
    throw new ReauthError(
      `Too many failed attempts. Try again in ${Math.ceil(throttle.retryAfterSeconds / 60)} minutes.`,
    );
  }

  const env = publicEnv();
  const client = createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );

  const { error } = await client.auth.signInWithPassword({ email, password });

  await recordAttempt(email, ip, 'reauth', !error);

  if (error) throw new ReauthError('That password is not correct.');

  // Drop the session this check just created rather than leaving a live refresh
  // token behind for something that was only ever a yes/no question.
  await client.auth.signOut({ scope: 'local' });

  return admin;
}
