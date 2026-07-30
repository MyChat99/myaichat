import 'server-only';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/db/server';
import type { UserRole } from '@/lib/db/types';

export type SessionUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole;
};

/**
 * Returns the signed-in user with their profile, or null.
 *
 * Uses getUser(), which verifies the token against the Auth server. getSession()
 * only decodes the cookie and must not be trusted for authorization.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url, role')
    .eq('id', user.id)
    .single();

  return {
    id: user.id,
    email: user.email ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    // Default to the least privilege if the profile row is somehow missing.
    role: profile?.role ?? 'user',
  };
}

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
