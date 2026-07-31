import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';
import type { Database } from '@/lib/db/types';

/** Routes an unauthenticated visitor may reach. */
const PUBLIC_PATHS = ['/login', '/signup', '/auth'];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * API routes still get their session cookie refreshed, but must never be
 * redirected: a caller expecting JSON would otherwise receive a 307 to the
 * HTML login page, which a default `fetch` follows into a misleading 200.
 * Route handlers do their own auth check and return a real 401.
 */
function isApiPath(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Refreshes the Supabase session cookie on every request and performs the
 * first-pass redirect for protected routes.
 *
 * This is a convenience gate, NOT an authorization boundary — middleware can be
 * bypassed in some deployment topologies. Every protected page and route
 * handler re-checks auth server-side, and RLS is the real backstop.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates against the Auth server. Do not swap this for
  // getSession(), which trusts the cookie without verifying it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (isApiPath(pathname)) return response;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
