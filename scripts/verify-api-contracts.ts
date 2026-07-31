/**
 * Every API route must REJECT before it accepts.
 *
 * The existing suites prove the happy paths work. This one only ever asserts
 * refusals: no session, malformed body, another user's resource, values outside
 * the schema. Those are the paths nobody exercises by hand, so they are the
 * paths that rot.
 *
 * Two rules the assertions here follow:
 *
 *  1. **Status AND content type.** ISSUE-011 was an unauthenticated POST that
 *     returned 200 with an HTML login page — a test checking only "not 2xx"
 *     would have passed it, and a test checking only status would have missed
 *     that JSON callers get HTML.
 *  2. **A refusal must not explain itself too well.** Asking for another user's
 *     conversation must not answer "that exists but is not yours".
 *
 * Needs `npm run dev` running.
 *
 *   npm run verify:api
 */
import './_env';

import { createClient } from '@supabase/supabase-js';

import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = 'contract-probe-passphrase-71';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = '') {
  checks++;
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function section(title: string) {
  console.log(`\n${title}\n`);
}

const admin = createClient(SUPABASE_URL(), SECRET_KEY(), { auth: { persistSession: false } });

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

/** Signs in and returns the cookie header a browser would send. */
async function sessionFor(email: string): Promise<string> {
  const client = createClient(SUPABASE_URL(), PUBLISHABLE_KEY(), {
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw error ?? new Error('no session');

  // @supabase/ssr stores the whole session as a JSON cookie, base64-prefixed.
  const ref = SUPABASE_URL().split('//')[1]!.split('.')[0];
  const payload = Buffer.from(JSON.stringify(data.session)).toString('base64');
  return `sb-${ref}-auth-token=base64-${payload}`;
}

type Probe = {
  label: string;
  path: string;
  method?: string;
  body?: unknown;
  cookie?: string;
  /** Any of these statuses is a pass — some rejections legitimately vary. */
  expect: number[];
  json?: boolean;
};

async function probe(p: Probe) {
  const response = await fetch(`${BASE}${p.path}`, {
    method: p.method ?? 'GET',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(p.cookie ? { cookie: p.cookie } : {}),
    },
    body: p.body === undefined ? undefined : JSON.stringify(p.body),
  });

  const okStatus = p.expect.includes(response.status);
  check(p.label, okStatus, `got ${response.status}, wanted ${p.expect.join('/')}`);

  if (p.json !== false && okStatus) {
    const type = response.headers.get('content-type') ?? '';
    check(
      `  ${p.label} answers JSON, not an HTML page`,
      type.includes('application/json'),
      type || '(none)',
    );
  }

  return response;
}

async function main() {
  console.log(`API contracts — refusals only · ${BASE}\n`);

  const stamp = Date.now();
  const ownerEmail = `contract-owner-${stamp}@example.invalid`;
  const otherEmail = `contract-other-${stamp}@example.invalid`;

  let ownerId = '';
  let otherId = '';

  try {
    ownerId = await makeUser(ownerEmail);
    otherId = await makeUser(otherEmail);
  } catch (err) {
    console.error('Could not create probe users:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  try {
    const ownerCookie = await sessionFor(ownerEmail);
    const otherCookie = await sessionFor(otherEmail);

    // A conversation belonging to the OWNER, which "other" must never reach.
    const { data: conversation } = await admin
      .from('conversations')
      .insert({ user_id: ownerId, title: 'contract probe', model_id: null })
      .select('id')
      .single();

    const conversationId = conversation!.id;

    // ───────────────────────────────────────────────── unauthenticated
    section('Unauthenticated — every route');

    await probe({
      label: 'POST /api/chat without a session is 401',
      path: '/api/chat',
      method: 'POST',
      body: { conversationId },
      expect: [401],
    });

    await probe({
      label: 'POST /api/uploads/presign without a session is 401',
      path: '/api/uploads/presign',
      method: 'POST',
      body: { filename: 'a.png', mimeType: 'image/png', sizeBytes: 10 },
      expect: [401],
    });

    await probe({
      label: 'GET /api/uploads/download without a session is 401',
      path: '/api/uploads/download?key=chat/x/y.png',
      expect: [401],
    });

    // /api/health is public on purpose (Railway probes it before any session).
    const health = await fetch(`${BASE}/api/health`);
    check('GET /api/health is public by design', health.status === 200, `got ${health.status}`);

    // ───────────────────────────────────────────────── malformed input
    section('Malformed input — authenticated, still refused');

    await probe({
      label: 'chat: missing conversationId is 400',
      path: '/api/chat',
      method: 'POST',
      body: { message: 'hello' },
      cookie: ownerCookie,
      expect: [400],
    });

    await probe({
      label: 'chat: non-UUID conversationId is 400',
      path: '/api/chat',
      method: 'POST',
      body: { conversationId: 'not-a-uuid', message: 'hi' },
      cookie: ownerCookie,
      expect: [400],
    });

    await probe({
      label: 'chat: empty message is 400',
      path: '/api/chat',
      method: 'POST',
      body: { conversationId, message: '   ' },
      cookie: ownerCookie,
      expect: [400],
    });

    await probe({
      label: 'chat: six attachments exceeds the cap',
      path: '/api/chat',
      method: 'POST',
      body: {
        conversationId,
        message: 'hi',
        attachments: Array.from({ length: 6 }, (_, i) => ({
          key: `chat/${ownerId}/f${i}.png`,
          name: `f${i}.png`,
          mimeType: 'image/png',
          sizeBytes: 10,
          kind: 'image',
        })),
      },
      cookie: ownerCookie,
      expect: [400],
    });

    await probe({
      label: 'chat: unknown attachment kind is 400',
      path: '/api/chat',
      method: 'POST',
      body: {
        conversationId,
        message: 'hi',
        attachments: [
          {
            key: `chat/${ownerId}/a.exe`,
            name: 'a.exe',
            mimeType: 'application/x-msdownload',
            sizeBytes: 10,
            kind: 'executable',
          },
        ],
      },
      cookie: ownerCookie,
      expect: [400],
    });

    await probe({
      label: 'presign: negative size is 400',
      path: '/api/uploads/presign',
      method: 'POST',
      body: { filename: 'a.png', mimeType: 'image/png', sizeBytes: -1 },
      cookie: ownerCookie,
      expect: [400],
    });

    await probe({
      label: 'presign: a disallowed MIME type is 415',
      path: '/api/uploads/presign',
      method: 'POST',
      body: { filename: 'a.svg', mimeType: 'image/svg+xml', sizeBytes: 100 },
      cookie: ownerCookie,
      expect: [415],
    });

    await probe({
      label: 'presign: an oversized file is 413',
      path: '/api/uploads/presign',
      method: 'POST',
      body: { filename: 'a.png', mimeType: 'image/png', sizeBytes: 500 * 1024 * 1024 },
      cookie: ownerCookie,
      expect: [413],
    });

    await probe({
      label: 'presign: a non-image avatar is 415',
      path: '/api/uploads/presign',
      method: 'POST',
      body: { filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, scope: 'avatar' },
      cookie: ownerCookie,
      expect: [415],
    });

    await probe({
      label: 'download: a missing key is 400',
      path: '/api/uploads/download',
      cookie: ownerCookie,
      expect: [400],
    });

    // ───────────────────────────────────────────────── wrong user
    section("Another user's resources");

    await probe({
      label: "chat: another user's conversation is 404, not 403",
      path: '/api/chat',
      method: 'POST',
      body: { conversationId, message: 'let me in' },
      cookie: otherCookie,
      expect: [404],
    });

    await probe({
      label: "download: another user's object key is 404",
      path: `/api/uploads/download?key=${encodeURIComponent(`chat/${ownerId}/secret.png`)}`,
      cookie: otherCookie,
      expect: [404],
    });

    await probe({
      label: 'download: a key with no user prefix is 404',
      path: '/api/uploads/download?key=chat/../../etc/passwd',
      cookie: otherCookie,
      expect: [400, 404],
    });

    await probe({
      label: 'chat: an attachment key owned by someone else is 404',
      path: '/api/chat',
      method: 'POST',
      body: {
        conversationId,
        message: 'hi',
        attachments: [
          {
            key: `chat/${ownerId}/theirs.png`,
            name: 'theirs.png',
            mimeType: 'image/png',
            sizeBytes: 10,
            kind: 'image',
          },
        ],
      },
      cookie: otherCookie,
      expect: [404],
    });

    // A 404 for "not yours" and a 404 for "does not exist" must be
    // indistinguishable, or the difference is an existence oracle.
    const foreign = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie: otherCookie },
      body: JSON.stringify({ conversationId, message: 'x' }),
    });
    const absent = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie: otherCookie },
      body: JSON.stringify({
        conversationId: '00000000-0000-4000-8000-000000000000',
        message: 'x',
      }),
    });
    const foreignBody = await foreign.text();
    const absentBody = await absent.text();
    check(
      'a foreign conversation is indistinguishable from a missing one',
      foreign.status === absent.status && foreignBody === absentBody,
      `${foreign.status} vs ${absent.status}`,
    );

    // ───────────────────────────────────────────────── admin surfaces
    section('Admin surfaces, as a normal user');

    for (const path of [
      '/admin',
      '/admin/providers',
      '/admin/models',
      '/admin/users',
      '/admin/settings',
      '/admin/analytics',
      '/admin/audit',
    ]) {
      const response = await fetch(`${BASE}${path}`, {
        redirect: 'manual',
        headers: { cookie: otherCookie },
      });
      check(
        `${path} refuses a non-admin`,
        response.status >= 300 && response.status < 400,
        `got ${response.status}`,
      );
    }

    // ───────────────────────────────────────────────── regression
    section('Regression — history window (fixed 2026-07-31)');

    /**
     * `.order(created_at, ascending: true).limit(N)` returns the OLDEST N. The
     * chat route used exactly that, so past N messages the model was sent the
     * beginning of the thread and never saw the question just asked. Nothing
     * errored; the only symptom was an assistant that appeared to stop paying
     * attention on long threads.
     */
    const WINDOW = 40;
    const rows = Array.from({ length: WINDOW + 5 }, (_, i) => ({
      conversation_id: conversationId,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `probe message ${i}`,
      // Explicit, spaced timestamps: a bulk insert can otherwise land several
      // rows on an identical `now()`, which makes "the newest" ambiguous.
      created_at: new Date(Date.now() - (WINDOW + 5 - i) * 60_000).toISOString(),
    }));
    await admin.from('messages').insert(rows);

    const { data: windowed } = await admin
      .from('messages')
      .select('content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(WINDOW);

    const ordered = (windowed ?? []).reverse().map((m) => m.content);

    check(
      `the window holds ${WINDOW} messages`,
      ordered.length === WINDOW,
      `got ${ordered.length}`,
    );
    check(
      'the window ENDS with the newest message',
      ordered[ordered.length - 1] === `probe message ${WINDOW + 4}`,
      ordered[ordered.length - 1],
    );
    check(
      'the window DROPS the oldest messages',
      !ordered.includes('probe message 0'),
      'the oldest message is still in the window',
    );
    check('the window is chronological', ordered[0]!.localeCompare(ordered[1]!) !== 0);
  } finally {
    await admin.auth.admin.deleteUser(ownerId).catch(() => {});
    await admin.auth.admin.deleteUser(otherId).catch(() => {});
    console.log('\nProbe users cleaned up.');
  }

  console.log(
    failures === 0
      ? `\nAll ${checks} contract checks passed.`
      : `\n${failures} of ${checks} contract checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
