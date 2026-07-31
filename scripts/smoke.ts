/**
 * End-to-end smoke test against a running server.
 *
 * Everything else in `scripts/` tests the code or the database. This tests a
 * *deployment*: the built server, its environment, and whatever sits in front
 * of it. That is a different question — `verify:headers` proves the header
 * config is right, and only this can prove a proxy is not stripping it on the
 * way out.
 *
 *   npm run smoke                              # http://localhost:3000
 *   npm run smoke -- --url https://example.com
 *
 * Read-only by design. It signs in only if SMOKE_EMAIL and SMOKE_PASSWORD are
 * set, and it never sends a chat message — a smoke test that spends real
 * provider tokens on every run is one people turn off.
 */
import './_env';

const urlArg = process.argv.indexOf('--url');
const BASE = (urlArg !== -1 ? process.argv[urlArg + 1] : undefined) ?? 'http://localhost:3000';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = '') {
  checks++;
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function get(path: string, init?: RequestInit) {
  // `redirect: 'manual'` matters: following redirects silently turns a
  // "protected page sent me to /login" into a 200, which is how ISSUE-011 hid
  // an unauthenticated API call returning an HTML login page with status 200.
  return fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
}

async function main() {
  console.log(`Smoke test — ${BASE}\n`);

  // ------------------------------------------------------------------ health
  console.log('Health');

  let health: Response;
  try {
    health = await get('/api/health');
  } catch (err) {
    console.error(`\n  Could not reach ${BASE}: ${err instanceof Error ? err.message : err}`);
    console.error('  Start the server first (npm run dev), or pass --url.');
    process.exit(1);
  }

  check('/api/health responds 200', health.status === 200, `got ${health.status}`);

  const body = (await health.json().catch(() => null)) as {
    status?: string;
    // The endpoint reports each dependency as a plain string ("ok" or a reason).
    checks?: Record<string, string>;
  } | null;

  check('reports a status', body?.status === 'ok', JSON.stringify(body));

  const dependencies = Object.entries(body?.checks ?? {});
  check('reports at least one dependency', dependencies.length > 0);

  for (const [name, result] of dependencies) {
    check(`dependency "${name}"`, result === 'ok', String(result));
  }

  // ----------------------------------------------------------------- headers
  console.log('\nSecurity headers, as actually served');

  const page = await get('/login');
  check('/login renders', page.status === 200, `got ${page.status}`);

  const expected: [string, (v: string | null) => boolean, string][] = [
    [
      'content-security-policy',
      (v) => Boolean(v && v.includes("default-src 'self'")),
      "default-src 'self'",
    ],
    ['x-frame-options', (v) => v === 'DENY', 'DENY'],
    ['x-content-type-options', (v) => v === 'nosniff', 'nosniff'],
    [
      'referrer-policy',
      (v) => v === 'strict-origin-when-cross-origin',
      'strict-origin-when-cross-origin',
    ],
    ['cross-origin-opener-policy', (v) => v === 'same-origin', 'same-origin'],
    ['permissions-policy', (v) => Boolean(v && v.includes('camera=()')), 'camera=()'],
  ];

  for (const [header, ok, want] of expected) {
    const value = page.headers.get(header);
    check(
      `${header} survives to the client`,
      ok(value),
      `wanted ${want}, got ${value ?? '(absent)'}`,
    );
  }

  // HSTS is only sent over HTTPS by any sane proxy, so only assert it there.
  if (BASE.startsWith('https://')) {
    check(
      'strict-transport-security is present over HTTPS',
      Boolean(page.headers.get('strict-transport-security')),
    );
  } else {
    console.log('  skip  strict-transport-security (only meaningful over HTTPS)');
  }

  // ------------------------------------------------------------------- gates
  console.log('\nAuthentication gates');

  const root = await get('/');
  check(
    'anonymous / redirects to the login page',
    root.status >= 300 &&
      root.status < 400 &&
      (root.headers.get('location') ?? '').includes('/login'),
    `status ${root.status}, location ${root.headers.get('location')}`,
  );

  const admin = await get('/admin');
  check(
    'anonymous /admin redirects',
    admin.status >= 300 && admin.status < 400,
    `got ${admin.status}`,
  );

  const chat = await get('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: '00000000-0000-4000-8000-000000000000' }),
  });

  // The ISSUE-011 regression guard: this must be a JSON 401, not a redirect to
  // an HTML page, and definitely not a 200.
  check('anonymous POST /api/chat is 401', chat.status === 401, `got ${chat.status}`);
  check(
    'and answers with JSON, not an HTML login page',
    (chat.headers.get('content-type') ?? '').includes('application/json'),
    chat.headers.get('content-type') ?? '(none)',
  );

  // ------------------------------------------------------------------ assets
  console.log('\nBranding assets');

  for (const [path, type] of [
    ['/icon.svg', 'image/svg+xml'],
    ['/opengraph-image', 'image/png'],
  ] as const) {
    const asset = await get(path);
    check(
      `${path} is served as ${type}`,
      asset.status === 200 && (asset.headers.get('content-type') ?? '').includes(type),
      `status ${asset.status}, type ${asset.headers.get('content-type')}`,
    );
  }

  // ---------------------------------------------------------- signed-in pass
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;

  if (!email || !password) {
    console.log('\n  skip  signed-in checks (set SMOKE_EMAIL and SMOKE_PASSWORD to enable)');
  } else {
    console.log('\nSigned-in pass');

    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    check('the smoke account can sign in', !error && Boolean(data.session), error?.message);
    await client.auth.signOut().catch(() => {});
  }

  console.log(
    failures === 0
      ? `\nAll ${checks} smoke checks passed against ${BASE}.`
      : `\n${failures} of ${checks} smoke checks FAILED against ${BASE}.`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

void main();
