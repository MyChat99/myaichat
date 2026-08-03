import 'server-only';

import { createAdminClient } from '@/lib/db/admin';

/**
 * Who is allowed to create an account.
 *
 * This exists because the admin panel already had a "Allow new signups" switch
 * that was **read by nothing**. It rendered, it saved, and the signup action
 * never looked at it — so turning signups off left them on. On a deployment
 * whose provider keys are funded by one person's card, a control that appears
 * to close the door and does not is worse than no control at all: it is the
 * one you would rely on before sharing the link.
 *
 * Three modes, expressed with two settings so no migration is needed and the
 * existing switch keeps its meaning:
 *
 *   open      `signups_enabled` true, no domain list
 *   domain    `signups_enabled` true, `signup_allowed_domains` non-empty
 *   closed    `signups_enabled` false — the admin creates accounts
 *
 * "Closed" is the invite-only equivalent for now. Invite CODES — a table, an
 * admin screen to issue and revoke them, and an email — are a separate piece of
 * work; closed delivers the protection today without pretending to more.
 */

export type SignupDecision = { allowed: true } | { allowed: false; reason: string };

export type SignupPolicy = {
  enabled: boolean;
  /** Lower-cased, no leading `@`. Empty means any domain. */
  allowedDomains: string[];
  mode: 'open' | 'domain' | 'closed';
};

function normaliseDomains(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  return raw
    .map((d) => String(d).trim().toLowerCase().replace(/^@/, ''))
    .filter((d) => d.length > 0 && d.includes('.'));
}

export async function loadSignupPolicy(): Promise<SignupPolicy> {
  const db = createAdminClient();
  const { data } = await db
    .from('system_settings')
    .select('key, value')
    .in('key', ['signups_enabled', 'signup_allowed_domains']);

  const rows = new Map((data ?? []).map((r) => [r.key, r.value]));

  // A missing row means signups are open — that is how this deployment has
  // always behaved, and quietly closing an existing app on upgrade would lock
  // out a legitimate user mid-signup.
  const enabledValue = rows.get('signups_enabled');
  const enabled =
    enabledValue === undefined || enabledValue === null ? true : Boolean(enabledValue);
  const allowedDomains = normaliseDomains(rows.get('signup_allowed_domains'));

  return {
    enabled,
    allowedDomains,
    mode: !enabled ? 'closed' : allowedDomains.length > 0 ? 'domain' : 'open',
  };
}

/**
 * May this address create an account?
 *
 * The refusals name the policy, not the address. "That domain is not on the
 * list" tells someone what to do; it reveals nothing about who already has an
 * account here, which is the property the sign-in errors are careful about too.
 */
export async function checkSignupAllowed(email: string): Promise<SignupDecision> {
  const policy = await loadSignupPolicy();

  if (!policy.enabled) {
    return {
      allowed: false,
      reason: 'New accounts are closed on this deployment. Ask an administrator for access.',
    };
  }

  if (policy.allowedDomains.length > 0) {
    const domain = email.split('@')[1]?.trim().toLowerCase() ?? '';
    if (!policy.allowedDomains.includes(domain)) {
      return {
        allowed: false,
        reason: `Accounts here are limited to ${policy.allowedDomains.map((d) => `@${d}`).join(', ')}.`,
      };
    }
  }

  return { allowed: true };
}

export function describeSignupMode(policy: SignupPolicy): string {
  if (policy.mode === 'closed') return 'Closed — only an administrator can create accounts';
  if (policy.mode === 'domain')
    return `Restricted to ${policy.allowedDomains.map((d) => `@${d}`).join(', ')}`;
  return 'Open — anyone with the link can create an account';
}
