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

/** Server-side gate for authenticated pages. Redirects to /login if signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
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
