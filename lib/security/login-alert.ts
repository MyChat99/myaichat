import 'server-only';

import { createHmac } from 'node:crypto';

import { createAdminClient } from '@/lib/db/admin';

/**
 * "New login" alerts, for administrator accounts only.
 *
 * ## Why only admins
 *
 * An admin account can read every provider key's last four, rotate keys,
 * suspend users and promote others. Those are the credentials worth stealing,
 * and the account whose owner will actually act on an unexpected alert. Sending
 * the same mail to every user would be noise for them and cost for us, and
 * would not make the admin account any safer.
 *
 * ## Why "new" rather than "every"
 *
 * Alerting on every sign-in trains the recipient to delete it unread — and then
 * the one that matters looks exactly like the ninety before it. A login counts
 * as new when its (IP + user-agent) fingerprint has not been seen for that
 * account before.
 *
 * ## What is stored
 *
 * An HMAC of the fingerprint, never the raw IP or user-agent. A table recording
 * where an administrator physically signs in from is a worse thing to hold than
 * the problem it solves, and it would be a genuinely valuable target.
 *
 * ## Why this module does not send the email
 *
 * It decides and records; the caller notifies. That split was forced by a real
 * constraint — `server-only` needs the `react-server` condition, and React
 * Email needs `react-dom/server`, which that condition removes, so a module
 * importing both cannot be loaded by a test at all. It turned out to be the
 * better shape regardless: the policy is now testable without a mail
 * transport, which is the part worth testing.
 *
 * ## Honest limits
 *
 * A dynamic IP or a browser update changes the fingerprint, so a legitimate
 * user will sometimes get an alert for their own laptop. That is the correct
 * direction to be wrong in — a false alert is an annoyance, a missed one is a
 * breach nobody noticed. And an attacker on the same network with a copied
 * user-agent produces no alert at all; this detects a *new place*, not a
 * compromise.
 */

/** Deliberately coarse: a precise fingerprint alerts on every browser update. */
export function fingerprint(ip: string, userAgent: string): string | null {
  const secret = process.env.ENCRYPTION_MASTER_KEY;
  if (!secret) return null;

  /**
   * Every version number is stripped, not merely shortened.
   *
   * The first attempt kept the major version — which is exactly the digit that
   * changes when Chrome ships, every four weeks. That would have alerted every
   * administrator roughly monthly about their own laptop, and an alert that
   * cries wolf monthly is one nobody reads on the day it matters.
   *
   * What survives is browser family, engine and platform: "Chrome on macOS" is
   * one device, "Firefox on macOS" and "Chrome on Windows" are others.
   */
  const coarseAgent = userAgent
    .replace(/[\d]+(?:[._][\d]+)*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

  return createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${ip}|${coarseAgent}`)
    .digest('base64url');
}

export type LoginContext = {
  userId: string;
  email: string;
  isAdmin: boolean;
  ip: string;
  userAgent: string;
};

/**
 * Records the sign-in and alerts if the device is new.
 *
 * NEVER throws and never blocks the caller's happy path. A failure to send an
 * alert must not fail a login — an admin locked out because Resend was briefly
 * unreachable is a worse outcome than a missed notification.
 */
export async function noteSignIn(context: LoginContext): Promise<{
  known: boolean;
  /** True when the caller should send the alert. */
  shouldAlert: boolean;
}> {
  const unknown = { known: true, shouldAlert: false };

  try {
    if (!context.isAdmin) return unknown;

    const print = fingerprint(context.ip, context.userAgent);
    if (!print) return unknown;

    const db = createAdminClient();

    const { data: existing } = await db
      .from('known_logins')
      .select('id')
      .eq('user_id', context.userId)
      .eq('fingerprint', print)
      .maybeSingle();

    if (existing) {
      await db
        .from('known_logins')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', existing.id);
      return { known: true, shouldAlert: false };
    }

    // Record BEFORE sending. If the send fails we still remember the device,
    // so a flapping mail provider cannot produce the same alert on every
    // attempt — which would be the noise this design exists to avoid.
    await db.from('known_logins').insert({ user_id: context.userId, fingerprint: print });

    // A first-ever login has nothing to compare against, so alerting on it says
    // only "you signed up". Suppressed.
    const { count } = await db
      .from('known_logins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', context.userId);

    if ((count ?? 0) <= 1) return { known: false, shouldAlert: false };

    return { known: false, shouldAlert: true };
  } catch (err) {
    // Logged, swallowed. Nothing here is worth failing a sign-in over.
    console.error('[login-alert] failed:', err instanceof Error ? err.message : err);
    return unknown;
  }
}
