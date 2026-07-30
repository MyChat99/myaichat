import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';
import type { Database } from '@/lib/db/types';

/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * Still uses the PUBLISHABLE key: this client acts as the signed-in user and
 * is subject to RLS. For privileged work use `lib/db/admin.ts` instead.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore: middleware refreshes the session on every request.
          }
        },
      },
    },
  );
}
