import { NextResponse } from 'next/server';

import { ping } from '@/lib/security/keepalive';

/**
 * The keep-alive endpoint.
 *
 * PUBLIC on purpose, and it has to be: the whole failure this guards against is
 * nobody signing in for a week, so an authenticated ping would be silent
 * exactly when it mattered. It is reachable from the signed-out sign-in page.
 *
 * What that costs, and how it is bounded: the write happens at most once every
 * six hours however much traffic arrives, and a short in-process guard drops
 * repeat requests before they reach the database. Nothing about a caller is
 * recorded, and nothing about the deployment is returned — a failure answers
 * `{ ok: false }` with no reason attached, because the reason is a database
 * error message and this is an unauthenticated endpoint.
 */

export const runtime = 'nodejs';
/** Never cached: a cached keep-alive keeps nothing alive. */
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await ping();

  return NextResponse.json(
    { ok: result.ok },
    {
      status: result.ok ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
