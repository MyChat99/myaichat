import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/db/admin';
import { toAppError } from '@/lib/errors/app-error';

/**
 * Health check for Railway.
 *
 * Deliberately checks reachable dependencies rather than returning a bare
 * "ok": a process that is up but cannot reach its database is not healthy, and
 * a health check that says otherwise makes deploys look successful when they
 * are not.
 *
 * Public on purpose — it exposes no data, only whether the service works.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Presence of required configuration — names and booleans only, never values.
 *
 * This is what turns "database: fail" into something actionable on a host
 * whose variables you cannot inspect from here. A missing variable and a wrong
 * one are very different problems, and the bare check cannot tell them apart.
 */
function configPresence() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ENCRYPTION_MASTER_KEY: Boolean(process.env.ENCRYPTION_MASTER_KEY),
  };
}

export async function GET() {
  const checks: Record<string, 'ok' | 'fail'> = {};
  let databaseError: string | null = null;

  // Database: a trivial query that exercises the connection and credentials.
  try {
    const { error } = await createAdminClient()
      .from('system_settings')
      .select('key', { count: 'exact', head: true });

    checks.database = error ? 'fail' : 'ok';

    /**
     * CLASSIFIED, not echoed.
     *
     * This endpoint is unauthenticated — it has to be, Railway probes it before
     * any session exists. It previously surfaced `error.message` verbatim on
     * the argument that Supabase describes the failure rather than the
     * credential. That is true of the errors you see while everything works,
     * and it is exactly the wrong thing to rely on: the messages that appear
     * during a real outage are the ones carrying a host, a port or a role name,
     * and by then they are already public.
     *
     * `verify:degradation` could not catch this, because it only ever ran
     * against a healthy database — the failure branch was never exercised.
     *
     * The classified kind still distinguishes "cannot reach it" from "it
     * rejected our credentials", which is the whole diagnostic value the raw
     * text was there for.
     */
    if (error) {
      const failure = toAppError(new Error(error.message), 'database');
      databaseError = failure.kind;
      console.error('[api/health] database check failed:', failure.kind, failure.detail);
    }
  } catch (err) {
    checks.database = 'fail';
    const failure = toAppError(err, 'database');
    databaseError = failure.kind;
    console.error('[api/health] database check threw:', failure.kind, failure.detail);
  }

  // Encryption: without this the app cannot decrypt any provider key, so it
  // would boot and then fail on the first message.
  checks.encryption = process.env.ENCRYPTION_MASTER_KEY ? 'ok' : 'fail';

  const healthy = Object.values(checks).every((v) => v === 'ok');

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks,
      ...(healthy ? {} : { config: configPresence(), databaseError }),
    },
    { status: healthy ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
