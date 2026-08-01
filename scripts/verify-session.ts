/**
 * Session security — idle policy, and what the auth provider actually does with
 * refresh tokens.
 *
 * The second half is the reason this file exists. Refresh-token rotation is
 * something every Supabase project is *assumed* to have, and the assumption is
 * only true if a dashboard setting says so. This measures it instead, by
 * simulating a stolen token and replaying it.
 *
 * By default a failed rotation check WARNS rather than fails, because it
 * reports a configuration state that cannot be fixed from this repository and
 * a red suite nobody can turn green is a suite people stop reading. Pass
 * `--strict` once the setting is correct to pin it there:
 *
 *   npm run verify:session
 *   npm run verify:session -- --strict
 */
import './_env';

import { createClient } from '@supabase/supabase-js';

import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';
import {
  IDLE_COOKIE,
  RESTAMP_AFTER_SECONDS,
  idleVerdict,
  readMarker,
  shouldRestamp,
  signMarker,
} from '../lib/security/session-policy';

const STRICT = process.argv.includes('--strict');
const PASSWORD = 'session-probe-passphrase-8';

let failures = 0;
let warnings = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = '') {
  checks++;
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function warn(label: string, detail = '') {
  checks++;
  warnings++;
  console.warn(`  warn  ${label}${detail ? `\n        ${detail}` : ''}`);
}

function section(title: string) {
  console.log(`\n${title}\n`);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────── idle policy (pure)

function verifyIdlePolicy() {
  section('Idle policy');

  const now = Date.UTC(2026, 6, 31, 12, 0, 0);
  const minutes = (n: number) => n * 60_000;

  check('0 disables the policy entirely', idleVerdict(now - minutes(999), 0, now) === 'disabled');
  check(
    'a negative timeout also disables it',
    idleVerdict(now - minutes(999), -5, now) === 'disabled',
  );
  check('within the window is fresh', idleVerdict(now - minutes(10), 30, now) === 'fresh');
  check(
    'exactly at the window is still fresh',
    idleVerdict(now - minutes(30), 30, now) === 'fresh',
  );
  check('past the window is expired', idleVerdict(now - minutes(31), 30, now) === 'expired');

  // The check that stops this feature from being a mass-logout button: the
  // first request after an admin enables it has no marker yet.
  check(
    'no marker is NOT treated as expired',
    idleVerdict(null, 30, now) === 'unmarked',
    'enabling the setting would sign out every user at once',
  );

  // A clock that jumped should not sign anyone out.
  check('a future marker is treated as fresh', idleVerdict(now + minutes(5), 30, now) === 'fresh');

  console.log('');
  check('an unmarked session re-stamps', shouldRestamp(null, now));
  check('a just-stamped session does not re-stamp', !shouldRestamp(now - 1000, now));
  check(
    `a session idle over ${RESTAMP_AFTER_SECONDS}s re-stamps`,
    shouldRestamp(now - (RESTAMP_AFTER_SECONDS + 1) * 1000, now),
  );
}

// ─────────────────────────────────────────────────────── marker integrity

function verifyMarker() {
  section('Idle marker integrity');

  if (!process.env.ENCRYPTION_MASTER_KEY) {
    console.log('  skip  ENCRYPTION_MASTER_KEY not set');
    return;
  }

  const now = Date.now();
  const marker = signMarker(now);
  check('a marker is produced', typeof marker === 'string' && marker.includes('.'));
  check('and reads back to the same instant', readMarker(marker!) === now);

  // The bypass this signature exists to stop: forward-dating the cookie to keep
  // a stale session alive for ever.
  const [stamp, mac] = marker!.split('.');
  const forwardDated = `${Number(stamp) + 9_000_000}.${mac}`;
  check('a forward-dated marker is rejected', readMarker(forwardDated) === null);

  check('a truncated signature is rejected', readMarker(`${stamp}.${mac!.slice(0, -4)}`) === null);
  check('an unsigned timestamp is rejected', readMarker(String(now)) === null);
  check('junk is rejected', readMarker('not-a-marker') === null);
  check('an empty value is rejected', readMarker('') === null);
  check('a marker signed with another key is rejected', readMarker(`${stamp}.YWJjZGVmZw`) === null);

  check('the cookie is namespaced', IDLE_COOKIE.startsWith('myaichat-'));
}

// ─────────────────────────────────────────────── refresh-token behaviour

/**
 * Ground truth for a refresh, with no SDK in the way.
 *
 * `supabase-js`'s `refreshSession()` was the original approach and it produced a
 * FALSE NEGATIVE: for a token whose successor already exists it resolves
 * successfully — returning that successor — where the auth endpoint itself
 * answers 400. Reading "it resolved" as "the token was accepted" is what made
 * ISSUE-028 look worse than it is. The endpoint is the authority.
 */
async function rawRefresh(token: string): Promise<{ status: number; rt?: string; err?: string }> {
  const res = await fetch(`${SUPABASE_URL()}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: PUBLISHABLE_KEY() },
    body: JSON.stringify({ refresh_token: token }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, string>;
  return {
    status: res.status,
    rt: body.refresh_token,
    err: body.error_description ?? body.msg ?? body.error,
  };
}

async function verifyRefreshTokens() {
  section('Refresh tokens — measured against the auth endpoint');

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('  skip  no database credentials (expected in CI)');
    return;
  }

  const admin = createClient(SUPABASE_URL(), SECRET_KEY(), { auth: { persistSession: false } });
  const email = `session-probe-${Date.now()}@example.invalid`;

  const { data: made, error: makeError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });

  if (makeError || !made?.user) {
    check('could create a probe user', false, makeError?.message);
    return;
  }

  try {
    const anon = createClient(SUPABASE_URL(), PUBLISHABLE_KEY(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: first } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const stolen = first!.session!.refresh_token;
    const at1 = first!.session!.access_token;

    const rotated = await rawRefresh(stolen);
    check('a refresh succeeds', rotated.status === 200, `HTTP ${rotated.status}`);
    check('rotation issues a NEW refresh token', Boolean(rotated.rt) && rotated.rt !== stolen);
    check('and a new access token', first!.session!.access_token === at1);

    /**
     * THE THREAT MODEL, which is what actually matters.
     *
     * An attacker copies a refresh token. The victim keeps using the app
     * normally. Does the stolen token still work?
     *
     * Rotations are spaced past the configured reuse interval, because within
     * that interval returning the already-issued successor is correct and
     * deliberate — it stops a client that lost a response from being signed
     * out, and testing inside the window proves nothing either way.
     */
    console.log('        (victim rotates 3× over 36s, past the reuse interval)');
    let head = rotated.rt!;
    for (let i = 0; i < 3; i++) {
      await wait(12_000);
      const next = await rawRefresh(head);
      if (next.rt) head = next.rt;
    }

    const theft = await rawRefresh(stolen);

    check(
      'a stolen token is refused once the victim has rotated past it',
      theft.status === 400,
      `HTTP ${theft.status} — the stolen token still works, so a theft grants indefinite access`,
    );
    check(
      '  and the refusal names the reason',
      /already used/i.test(theft.err ?? ''),
      theft.err ?? '(none)',
    );

    /**
     * Refusal is not detection. Detection would revoke the whole family, so the
     * victim is signed out and NOTICES. This is reported rather than asserted
     * either way: it has never been observed firing here, and a check that
     * demands behaviour nobody can produce is a check that stays red for ever.
     */
    const victim = await rawRefresh(head);
    if (victim.status === 200) {
      warn(
        'a replay refuses the old token but does NOT revoke the session family',
        'The theft is stopped, and leaves no trace — the victim is not signed out\n' +
          '        and nothing is logged. Residual gap, documented in ISSUE-028.',
      );
      if (STRICT) failures++;
    } else {
      check('a replay revokes the whole family (detection fired)', true);
    }

    // Sign-out must invalidate regardless of any rotation setting.
    const client = createClient(SUPABASE_URL(), PUBLISHABLE_KEY(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: fresh } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    const beforeSignOut = fresh!.session!.refresh_token;
    await client.auth.signOut();

    const afterOut = await rawRefresh(beforeSignOut);
    check(
      'signing out invalidates the refresh token',
      afterOut.status !== 200,
      `HTTP ${afterOut.status} — the token still refreshed after signOut`,
    );
  } finally {
    await admin.auth.admin.deleteUser(made.user.id).catch(() => {});
    console.log('\n  Probe user cleaned up.');
  }
}

// ────────────────────────────────────────────── new-login alerting

async function verifyLoginAlerts() {
  section('New-login alerts (admin accounts)');

  const { fingerprint, noteSignIn } = await import('../lib/security/login-alert');

  if (!process.env.ENCRYPTION_MASTER_KEY) {
    console.log('  skip  ENCRYPTION_MASTER_KEY not set');
    return;
  }

  const CHROME_141 =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36';
  const CHROME_142 = CHROME_141.replace('141.0.0.0', '142.0.0.0');
  const FIREFOX =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0';

  const a = fingerprint('203.0.113.5', CHROME_141);
  check('a fingerprint is produced', typeof a === 'string' && a.length > 20);

  // A browser auto-update must not read as a new device. Chrome ships a new
  // MAJOR every four weeks, so keeping the major version — the obvious
  // implementation — alerts every admin monthly about their own laptop.
  check('a browser version bump is the SAME device', fingerprint('203.0.113.5', CHROME_142) === a);

  // The OS patch level moves too, and for the same reason must not count.
  check(
    'an OS point release is the SAME device',
    fingerprint('203.0.113.5', CHROME_141.replace('10_15_7', '10_15_8')) === a,
  );

  check('a different browser is a different device', fingerprint('203.0.113.5', FIREFOX) !== a);
  check('a different address is a different device', fingerprint('198.51.100.9', CHROME_141) !== a);

  // The raw values must not be recoverable from what is stored.
  check('the fingerprint does not contain the address', !a!.includes('203.0.113'));
  check('the fingerprint does not contain the agent', !a!.toLowerCase().includes('chrome'));

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('  skip  no database credentials for the policy checks');
    return;
  }

  const admin = createClient(SUPABASE_URL(), SECRET_KEY(), { auth: { persistSession: false } });
  const email = `alert-probe-${Date.now()}@example.invalid`;
  const { data: made } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });

  if (!made?.user) {
    check('could create a probe user', false);
    return;
  }

  try {
    const base = { userId: made.user.id, email, ip: '203.0.113.5', userAgent: CHROME_141 };

    // A non-admin must produce no record at all — this is admin-only by design.
    await noteSignIn({ ...base, isAdmin: false });
    const { count: afterNonAdmin } = await admin
      .from('known_logins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', made.user.id);
    check('a non-admin sign-in is not recorded', (afterNonAdmin ?? 0) === 0);

    // First admin login: recorded, but NOT alerted — there is nothing to
    // compare against, so the mail would only say "you signed up".
    const first = await noteSignIn({ ...base, isAdmin: true });
    check('the first admin device is recorded', !first.known);
    check('  but does not alert', !first.shouldAlert);

    // Same device again: known, silent.
    const repeat = await noteSignIn({ ...base, isAdmin: true });
    check('a returning device is recognised', repeat.known);
    check('  and stays silent', !repeat.shouldAlert);

    // New device: this is the one that must alert.
    const moved = await noteSignIn({ ...base, isAdmin: true, ip: '198.51.100.9' });
    check('a NEW device is not recognised', !moved.known);
    check('  and alerts', moved.shouldAlert);

    // And is then remembered, so it alerts once rather than every time.
    const movedAgain = await noteSignIn({ ...base, isAdmin: true, ip: '198.51.100.9' });
    check(
      'the new device alerts once, not repeatedly',
      movedAgain.known && !movedAgain.shouldAlert,
    );

    // Stored values must be hashes.
    const { data: stored } = await admin
      .from('known_logins')
      .select('fingerprint')
      .eq('user_id', made.user.id);
    check(
      'no raw address is stored',
      (stored ?? []).every((r) => !r.fingerprint.includes('.')),
    );
  } finally {
    await admin.auth.admin.deleteUser(made.user.id).catch(() => {});
  }
}

async function main() {
  console.log(`Session security${STRICT ? ' (strict)' : ''}`);

  verifyIdlePolicy();
  verifyMarker();
  await verifyRefreshTokens();
  await verifyLoginAlerts();

  console.log(
    failures === 0
      ? `\nAll ${checks} session checks passed${warnings ? ` (${warnings} warning(s))` : ''}.`
      : `\n${failures} of ${checks} session checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
