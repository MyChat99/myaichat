import { NextResponse } from 'next/server';

import { createClient } from '@/lib/db/server';

/**
 * Where a suspended session goes to actually end.
 *
 * ## Why this exists rather than a straight redirect to /login
 *
 * `requireUser()` cannot sign anyone out: it runs during a Server Component
 * render, and a render cannot write cookies. So its first version simply
 * redirected a suspended user to `/login?suspended=1` — and the proxy, which
 * bounces any SIGNED-IN visitor off /login to `/`, sent them straight back.
 * `/` redirected to /login, /login redirected to `/`, and the browser gave up
 * with ERR_TOO_MANY_REDIRECTS. Caught by `verify:failures`, which drives that
 * exact path in a real browser; every server-side check I had written passed,
 * because each hop is individually correct.
 *
 * A Route Handler CAN write cookies. Signing out here means the visitor reaches
 * /login as an anonymous user, so the proxy has no opinion about them and the
 * loop cannot form — and, more to the point, the session is genuinely over
 * rather than merely refused at every door.
 *
 * `/auth` is already in the proxy's PUBLIC_PATHS, so this path is reachable
 * while signed in and while signed out.
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  // Best-effort: a failure here must still land the reader on the notice
  // rather than on an error page they cannot act on.
  await supabase.auth.signOut().catch(() => {});

  return NextResponse.redirect(new URL('/login?suspended=1', request.url));
}
