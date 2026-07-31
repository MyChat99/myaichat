import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';
import type { Database } from '@/lib/db/types';
import {
  IDLE_COOKIE,
  idleVerdict,
  readMarker,
  shouldRestamp,
  signMarker,
} from '@/lib/security/session-policy';

/**
 * Routes an unauthenticated visitor may reach.
 *
 * `/opengraph-image` is here because the link-preview crawlers that fetch it —
 * Slack, iMessage, every social platform — are by definition anonymous. Without
 * this it 307s to /login and the card never renders anywhere. Found by
 * `npm run smoke`, which is exactly the class of bug only a real request can
 * surface. The sibling icon routes end in .svg/.png and are already excluded by
 * the matcher in proxy.ts.
 */
const PUBLIC_PATHS = ['/login', '/signup', '/auth', '/opengraph-image'];

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
 * The idle timeout, cached in module scope.
 *
 * The proxy runs on every request, so reading a system setting from the
 * database here would put a round trip on the hot path of the whole app. The
 * value changes approximately never, so a 60-second cache is generous.
 *
 * Fails OPEN — any error yields 0, which disables the policy. The alternative
 * is a database hiccup signing out every user at once, and an idle timeout is
 * not worth that risk.
 */
let idleCache: { minutes: number; readAt: number } = { minutes: 0, readAt: 0 };
const IDLE_CACHE_MS = 60_000;

async function idleTimeoutMinutes(): Promise<number> {
  const now = Date.now();
  if (now - idleCache.readAt < IDLE_CACHE_MS) return idleCache.minutes;

  try {
    const { createAdminClient } = await import('@/lib/db/admin');
    const { data } = await createAdminClient()
      .from('system_settings')
      .select('value')
      .eq('key', 'session_idle_timeout_minutes')
      .maybeSingle();

    const minutes = typeof data?.value === 'number' && data.value > 0 ? data.value : 0;
    idleCache = { minutes, readAt: now };
    return minutes;
  } catch {
    idleCache = { minutes: 0, readAt: now };
    return 0;
  }
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
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
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

  /**
   * Idle expiry. Runs only for a signed-in user on a page request — never for
   * API routes, which must not be redirected (ISSUE-011), and never for anyone
   * already signed out.
   */
  if (user && !isApiPath(pathname)) {
    const minutes = await idleTimeoutMinutes();

    if (minutes > 0) {
      const now = Date.now();
      const lastSeen = readMarker(request.cookies.get(IDLE_COOKIE)?.value);
      const verdict = idleVerdict(lastSeen, minutes, now);

      if (verdict === 'expired') {
        await supabase.auth.signOut();
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        url.search = '';
        url.searchParams.set('reason', 'idle');
        const out = NextResponse.redirect(url);
        out.cookies.delete(IDLE_COOKIE);
        return out;
      }

      if (shouldRestamp(lastSeen, now)) {
        const marker = signMarker(now);
        if (marker) {
          response.cookies.set(IDLE_COOKIE, marker, {
            httpOnly: true,
            sameSite: 'lax',
            secure: request.nextUrl.protocol === 'https:',
            path: '/',
            maxAge: 60 * 60 * 24 * 7,
          });
        }
      }
    }
  }

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
