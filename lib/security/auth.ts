import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/db/server';
import type { UserRole } from '@/lib/db/types';

export type SessionUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  suspended: boolean;
  /** When the account was created. Drives the masthead's issue number. */
  createdAt: string;
};

/**
 * Returns the signed-in user with their profile, or null.
 *
 * Uses getUser(), which verifies the token against the Auth server. getSession()
 * only decodes the cookie and must not be trusted for authorization.
 *
 * ## Wrapped in `cache()`, and why it matters more than it looks
 *
 * Two round trips happen here — verify the token, then read the profile — and
 * they are genuinely sequential, because the profile is keyed by the id the
 * first call returns. What was NOT necessary is doing both of them twice.
 *
 * The `(app)` layout calls this, and so does every page inside it. Next renders
 * both in the same request, so every single page view paid for **four** round
 * trips to authenticate instead of two. `cache()` dedupes for the lifetime of
 * one request and nothing longer, so there is no staleness window and no
 * authorization decision is ever made from a cached value that outlives the
 * request that produced it.
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url, role, suspended, created_at')
    .eq('id', user.id)
    .single();

  return {
    id: user.id,
    email: user.email ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    // Default to the least privilege if the profile row is somehow missing.
    role: profile?.role ?? 'user',
    suspended: profile?.suspended ?? false,
    createdAt: profile?.created_at ?? user.created_at,
  };
});

/**
 * Server-side gate for authenticated pages.
 *
 * Redirects to /login if signed out — and if SUSPENDED, which is the same
 * outcome for a different reason and has to be said out loud because it did not
 * used to be true. Suspension was a read-only state: the flag was loaded here
 * and never enforced, so a suspended account kept every page. `/settings`
 * returned 200 for a suspended user, and because `requireAdmin` delegates here,
 * a suspended ADMIN kept the admin panel.
 *
 * Suspension now means revoked. Every authenticated page is unreachable, the
 * reader is told why on the login form, and un-suspending restores access with
 * no further action.
 *
 * Sent to `/auth/suspended` rather than straight to `/login`, because a render
 * cannot write cookies and this session has to actually END. That route signs
 * them out and then forwards to the notice.
 *
 * Redirecting here directly to `/login?suspended=1` looked right and was not:
 * the proxy bounces any signed-in visitor off /login back to `/`, `/` bounces
 * back to /login, and the browser stops with ERR_TOO_MANY_REDIRECTS. Every hop
 * was individually correct, which is why reading them one at a time did not
 * find it — `verify:failures` did, by driving the path in a browser.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.suspended) redirect('/auth/suspended');
  return user;
}

/**
 * Server-side gate for admin pages.
 *
 * Redirects non-admins to the app root rather than /login — they are
 * authenticated, just not authorized, and bouncing them to a login form
 * they have already satisfied is confusing.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/');
  return user;
}
