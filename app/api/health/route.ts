import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/db/admin';

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

export async function GET() {
  const checks: Record<string, 'ok' | 'fail'> = {};

  // Database: a trivial query that exercises the connection and credentials.
  try {
    const { error } = await createAdminClient()
      .from('system_settings')
      .select('key', { count: 'exact', head: true });
    checks.database = error ? 'fail' : 'ok';
  } catch {
    checks.database = 'fail';
  }

  // Encryption: without this the app cannot decrypt any provider key, so it
  // would boot and then fail on the first message.
  checks.encryption = process.env.ENCRYPTION_MASTER_KEY ? 'ok' : 'fail';

  const healthy = Object.values(checks).every((v) => v === 'ok');

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks },
    { status: healthy ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
