/**
 * Proves the route gates over real HTTP against a running dev server.
 *
 * Covers the Phase 1 acceptance criteria that RLS alone cannot: anonymous
 * visitors are redirected, an authenticated NON-ADMIN is turned away from
 * /admin, and an admin is let through.
 *
 * Sessions are forged by signing in with the publishable key and writing the
 * cookie in the exact format @supabase/ssr expects, so the server sees a
 * genuine session.
 *
 *   npm run dev            # in another terminal
 *   npm run verify:gates   # BASE_URL=http://localhost:3001 to override the port
 */
import { createClient, type Session } from '@supabase/supabase-js';

import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';
import type { Database } from '../lib/db/types';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];

// Matches @supabase/ssr's chunking threshold.
const CHUNK_SIZE = 3180;

const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = process.pid;
const PASSWORD = 'gate-test-password-1234';

let failures = 0;

function check(name: string, passed: boolean, detail = '') {
  if (passed) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

/** Serialises a session the way @supabase/ssr stores it, chunking when oversized. */
function sessionCookie(session: Session): string {
  const name = `sb-${projectRef}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`;

  if (value.length <= CHUNK_SIZE) return `${name}=${value}`;

  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(`${name}.${chunks.length}=${value.slice(i, i + CHUNK_SIZE)}`);
  }
  return chunks.join('; ');
}

async function makeUser(email: string, role: 'user' | 'admin') {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  if (role === 'admin') {
    const { error: roleErr } = await admin
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', data.user.id);
    if (roleErr) throw roleErr;
  }

  const client = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInErr) throw signInErr;

  return { id: data.user.id, cookie: sessionCookie(signIn.session!) };
}

async function visit(path: string, cookie?: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

async function main() {
  // Fail loudly rather than reporting phantom passes if the server is down.
  try {
    await fetch(BASE_URL, { redirect: 'manual' });
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first (npm run dev).`);
    process.exit(1);
  }

  console.log(`Testing gates against ${BASE_URL}\n`);

  const userEmail = `gate-user-${stamp}@example.com`;
  const adminEmail = `gate-admin-${stamp}@example.com`;
  const normal = await makeUser(userEmail, 'user');
  const superuser = await makeUser(adminEmail, 'admin');

  try {
    // --- anonymous ---------------------------------------------------------
    const anonRoot = await visit('/');
    check(
      'anon / redirects to /login',
      anonRoot.status === 307 && anonRoot.location.includes('/login'),
    );

    const anonAdmin = await visit('/admin');
    check(
      'anon /admin redirects to /login',
      anonAdmin.status === 307 && anonAdmin.location.includes('/login'),
    );

    const anonLogin = await visit('/login');
    check('anon /login renders', anonLogin.status === 200);

    // --- authenticated non-admin ------------------------------------------
    const userRoot = await visit('/', normal.cookie);
    check('signed-in user reaches /', userRoot.status === 200, `got ${userRoot.status}`);

    const userLogin = await visit('/login', normal.cookie);
    check(
      'signed-in user is bounced off /login',
      userLogin.status === 307 && !userLogin.location.includes('/login'),
    );

    const userAdmin = await visit('/admin', normal.cookie);
    check(
      'NON-ADMIN is redirected away from /admin',
      userAdmin.status === 307 && !userAdmin.location.includes('/admin'),
      `status ${userAdmin.status}, location "${userAdmin.location}"`,
    );

    // --- admin -------------------------------------------------------------
    const adminAdmin = await visit('/admin', superuser.cookie);
    check('admin reaches /admin', adminAdmin.status === 200, `got ${adminAdmin.status}`);
  } finally {
    await admin.auth.admin.deleteUser(normal.id).catch(() => {});
    await admin.auth.admin.deleteUser(superuser.id).catch(() => {});
    console.log('\nTest users cleaned up.');
  }

  console.log(failures === 0 ? '\nAll gate checks passed.' : `\n${failures} gate check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nverify-auth-gates crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
