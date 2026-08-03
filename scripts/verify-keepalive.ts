/**
 * The keep-alive, which exists to stop a silent total outage.
 *
 * A free Supabase project pauses after about a week of inactivity and takes the
 * whole application with it. The checks that matter here are the ones about
 * REACHABILITY: the endpoint has to work signed out, because the failure it
 * guards against is nobody signing in; and it has to be bounded, because a
 * public endpoint that writes on every request is an abuse surface.
 *
 *   npm run dev
 *   npm run verify:keepalive
 */
import { existsSync, readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import type { Database } from '../lib/db/types';
import { SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const admin = createClient<Database>(SUPABASE_URL(), SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

let failures = 0;
function check(name: string, passed: boolean, detail = '') {
  if (passed) console.log(`  ok    ${name}`);
  else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

async function main() {
  const before = await admin
    .from('system_settings')
    .select('value')
    .eq('key', 'last_keepalive_at')
    .maybeSingle();
  const original = before.data?.value ?? null;

  try {
    console.log('Reachable without an account\n');

    const anonymous = await fetch(`${BASE_URL}/api/ping`, { redirect: 'manual' });
    check(
      'the ping answers 200 with no session at all',
      anonymous.status === 200,
      `got ${anonymous.status}`,
    );
    check(
      'and it is not a redirect to the sign-in page',
      (anonymous.headers.get('content-type') ?? '').includes('json'),
      anonymous.headers.get('content-type') ?? '',
    );
    check(
      'and it is never cached, because a cached keep-alive keeps nothing alive',
      (anonymous.headers.get('cache-control') ?? '').includes('no-store'),
      anonymous.headers.get('cache-control') ?? '',
    );

    const body = await anonymous.json().catch(() => ({}));
    check('it reports success', body.ok === true, JSON.stringify(body));
    /**
     * The response must carry nothing about the deployment. This endpoint is
     * unauthenticated, and a database error message names a host and a role.
     */
    check(
      'and it returns nothing except ok — no timestamps, no error text',
      Object.keys(body).length === 1 && 'ok' in body,
      JSON.stringify(body),
    );

    console.log('\nIt actually touched the database\n');

    // Erase the marker, then ping, and see it come back.
    await admin.from('system_settings').delete().eq('key', 'last_keepalive_at');
    const { ping, activityStatus, isWriteDue } = await import('../lib/security/keepalive');

    const forced = await ping(true);
    check('a forced ping writes the marker', forced.wrote === true && forced.ok);
    check(
      'and reports a latency it actually measured',
      typeof forced.latencyMs === 'number' && forced.latencyMs! >= 0,
      String(forced.latencyMs),
    );

    const stored = await admin
      .from('system_settings')
      .select('value')
      .eq('key', 'last_keepalive_at')
      .maybeSingle();
    check(
      'and the marker is in the database, not just in the reply',
      typeof stored.data?.value === 'string',
    );

    console.log('\nThe write is bounded, the read is cheap\n');

    /**
     * TWO independent limiters, tested separately.
     *
     * A single "call it twice and see" check passed even with the durable
     * throttle deleted, because the in-process guard short-circuits a second
     * call inside a minute and the durable one was never consulted. The
     * decision is now a pure function, so it can be asked about timestamps a
     * test cannot otherwise reach.
     */
    const now = Date.now();
    check(
      'a write one minute old is not due again',
      isWriteDue(new Date(now - 60_000).toISOString(), now, false) === false,
    );
    check(
      'a write seven hours old is due',
      isWriteDue(new Date(now - 7 * 3_600_000).toISOString(), now, true) === true,
    );
    check(
      'and seven hours old is due even without forcing',
      isWriteDue(new Date(now - 7 * 3_600_000).toISOString(), now, false) === true,
    );
    check('no previous write at all is always due', isWriteDue(null, now, false) === true);
    check(
      'and forcing overrides a recent write',
      isWriteDue(new Date(now).toISOString(), now, true) === true,
    );

    // The in-process guard, separately: a second call inside the window does
    // not even reach the database, which is what `latencyMs === null` reports.
    const second = await ping(false);
    check(
      'and a repeat call inside the memory window never reaches the database',
      second.latencyMs === null && second.wrote === false,
      JSON.stringify(second),
    );

    console.log('\nThe operator can see how close it is\n');

    const status = await activityStatus();
    check(
      'status reports days since the last activity',
      typeof status.daysSince === 'number',
      String(status.daysSince),
    );
    check(
      'and it is fresh right after a ping',
      (status.daysSince ?? 99) < 1,
      String(status.daysSince),
    );
    check('and the level is ok', status.level === 'ok', status.level);

    // A marker from long ago must escalate.
    const stale = new Date(Date.now() - 9 * 86_400_000).toISOString();
    await admin
      .from('system_settings')
      .upsert({ key: 'last_keepalive_at', value: stale as never }, { onConflict: 'key' });
    const staleStatus = await activityStatus();
    check(
      'nine days idle reports critical, not a shrug',
      staleStatus.level === 'critical',
      staleStatus.level,
    );
    check(
      'and the message names the threshold so it is actionable',
      /pauses at around|pausing starts/i.test(staleStatus.message),
      staleStatus.message,
    );

    console.log('\nIt fires from the signed-out page\n');

    /**
     * Asserted on the SERVER path, because that is where it now lives.
     *
     * The first version fired this from a client `useEffect`. It worked, but it
     * left the page holding a request that never reported completion, so
     * `networkidle` was never reached and every Playwright `goto` in the suite
     * timed out at 45 seconds. Isolated by removing the component: a 40s
     * timeout became 1190ms. It moved to `after()` in the root layout, which
     * cannot delay first paint by construction and costs the visitor no
     * JavaScript.
     *
     * Checked structurally rather than by watching the marker change: other
     * suites hit this server constantly, and the six-hour write throttle makes
     * "did it change just now" genuinely unreliable rather than merely fussy.
     */
    const layout = readFileSync('app/layout.tsx', 'utf8');
    check(
      'the root layout schedules the keep-alive with after()',
      /after\(/.test(layout) && /ping\(\)/.test(layout),
    );
    check(
      'and it is not awaited on the render path',
      !/await\s+ping\(\);\s*\n\s*return/.test(layout),
    );
    check('no client component fires it any more', !existsSync('components/system/keepalive.tsx'));

    // And it really is reachable from a signed-out page view.
    await fetch(`${BASE_URL}/login`);
    await new Promise((r) => setTimeout(r, 2_000));
    const marker = await admin
      .from('system_settings')
      .select('value')
      .eq('key', 'last_keepalive_at')
      .maybeSingle();
    check(
      'and a signed-out visit leaves a keep-alive marker behind',
      typeof marker.data?.value === 'string',
      String(marker.data?.value),
    );
  } finally {
    if (original === null)
      await admin.from('system_settings').delete().eq('key', 'last_keepalive_at');
    else
      await admin
        .from('system_settings')
        .upsert({ key: 'last_keepalive_at', value: original as never }, { onConflict: 'key' });
    console.log('\nMarker restored.');
  }

  console.log(
    failures === 0
      ? '\nThe database gets touched, and it is bounded.'
      : `\n${failures} keep-alive check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-keepalive crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
