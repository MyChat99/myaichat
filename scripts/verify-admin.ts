/**
 * Proves the Phase 4 acceptance criteria.
 *
 * The interesting checks are the ones that could silently be false:
 *   - the chat pipeline really reads the ENCRYPTED DB key, not the env var
 *     (proved by breaking the DB value and watching chat fail)
 *   - disabling a provider really removes its models from the selector
 *   - every admin mutation gates on requireAdmin AND writes an audit row
 *
 *   npm run dev           # in another terminal
 *   npm run verify:admin  # BASE_URL=http://localhost:3001 to override the port
 */
import { execFileSync } from 'node:child_process';
import { createClient, type Session } from '@supabase/supabase-js';

import type { Database } from '../lib/db/types';
import { decryptSecret, encryptSecret, keyLast4 } from '../lib/security/crypto';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const CHUNK_SIZE = 3180;

const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = process.pid;
const PASSWORD = 'admin-test-password-1234';

let failures = 0;

function check(name: string, passed: boolean, detail = '') {
  if (passed) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

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
    await admin.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
  }

  const client = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  return { id: data.user.id, cookie: sessionCookie(signIn.session!), client };
}

async function visit(path: string, cookie?: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

async function sendChat(cookie: string, conversationId: string, message: string) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ conversationId, message }),
    redirect: 'manual',
  });

  if (!res.ok || !res.body) return { status: res.status, text: '', error: `HTTP ${res.status}` };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let error: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line) as { type: string; text?: string; message?: string };
      if (ev.type === 'text') text += ev.text ?? '';
      if (ev.type === 'error') error = ev.message ?? 'error';
    }
  }

  return { status: res.status, text, error };
}

async function newConversation(userId: string, modelId?: string) {
  const { data: model } = modelId
    ? { data: { id: modelId } }
    : await admin.from('models').select('id').eq('enabled', true).limit(1).single();

  const { data } = await admin
    .from('conversations')
    .insert({ user_id: userId, title: 'New chat', model_id: model?.id ?? null })
    .select('id')
    .single();
  return data!.id;
}

async function main() {
  console.log('Encryption at rest\n');

  // --- crypto primitives ---------------------------------------------------
  const secret = 'sk-test-abcdefghijklmnop';
  const ct1 = encryptSecret(secret);
  const ct2 = encryptSecret(secret);

  check('encrypt → decrypt round-trips', decryptSecret(ct1) === secret);
  check('the same plaintext encrypts differently each time (random IV)', ct1 !== ct2);
  check('ciphertext carries no plaintext', !ct1.includes(secret) && !ct1.includes('abcdefgh'));

  // GCM is authenticated: a flipped byte must fail loudly, not decrypt to junk.
  const parts = ct1.split('.');
  const tampered = [parts[0], parts[1], parts[2], `${parts[3].slice(0, -2)}AA`].join('.');
  let tamperRejected = false;
  try {
    decryptSecret(tampered);
  } catch {
    tamperRejected = true;
  }
  check('tampered ciphertext is rejected', tamperRejected);

  // --- stored keys ---------------------------------------------------------
  // Ordered on purpose: the target provider is picked from this list, and an
  // unordered query made the script disable a different provider on each run —
  // which turns a shared-database failure into a confusing intermittent one.
  const { data: providers } = await admin
    .from('providers')
    .select('name, encrypted_api_key, key_last4, enabled')
    .order('name');

  const withKeys = (providers ?? []).filter((p) => p.encrypted_api_key);
  check('providers have keys stored', withKeys.length >= 2, `${withKeys.length} with keys`);

  for (const p of withKeys) {
    const stored = p.encrypted_api_key!;
    check(
      `${p.name}: stored value is ciphertext, not a plaintext key`,
      stored.startsWith('v1.') && !/^sk-/.test(stored),
      stored.slice(0, 12),
    );

    const plaintext = decryptSecret(stored);
    check(`${p.name}: decrypts to a real-looking key`, plaintext.startsWith('sk-'));
    check(`${p.name}: key_last4 matches the key`, p.key_last4 === keyLast4(plaintext));
    check(`${p.name}: only the last 4 are stored in the clear`, (p.key_last4 ?? '').length <= 4);
  }

  // --- HTTP surface --------------------------------------------------------
  try {
    await fetch(BASE_URL, { redirect: 'manual' });
  } catch {
    console.error(`\nCannot reach ${BASE_URL}. Start the dev server first (npm run dev).`);
    process.exit(1);
  }

  console.log('\nAccess control\n');

  const normal = await makeUser(`admin-test-user-${stamp}@example.com`, 'user');
  const superuser = await makeUser(`admin-test-admin-${stamp}@example.com`, 'admin');

  const ADMIN_ROUTES = [
    '/admin',
    '/admin/providers',
    '/admin/models',
    '/admin/users',
    '/admin/settings',
  ];

  try {
    for (const route of ADMIN_ROUTES) {
      const anon = await visit(route);
      check(`anon blocked from ${route}`, anon.status === 307, `got ${anon.status}`);

      const asUser = await visit(route, normal.cookie);
      check(
        `non-admin blocked from ${route}`,
        asUser.status === 307 && !asUser.location.includes('/admin'),
        `status ${asUser.status} → ${asUser.location}`,
      );

      const asAdmin = await visit(route, superuser.cookie);
      // /admin itself redirects to /admin/providers, which is correct.
      check(
        `admin reaches ${route}`,
        asAdmin.status === 200 || (route === '/admin' && asAdmin.location.includes('/admin/')),
        `got ${asAdmin.status}`,
      );
    }

    // Every admin mutation must gate + audit. A route-level check alone would
    // miss a server action that forgot requireAdmin.
    const actionsSrc = execFileSync('git', ['show', 'HEAD:app/(app)/admin/actions.ts'], {
      encoding: 'utf8',
    }).toString();
    const exportedFns = actionsSrc.match(/export async function (\w+)/g) ?? [];
    const gateCount = (actionsSrc.match(/requireAdmin\(\)/g) ?? []).length;
    check(
      'every exported admin action calls requireAdmin()',
      gateCount >= exportedFns.length,
      `${exportedFns.length} actions, ${gateCount} gates`,
    );

    const auditCount = (actionsSrc.match(/auditLog\(\{/g) ?? []).length;
    // testProviderConnection and fetchProviderModels are reads, so they audit nothing.
    check(
      'every mutating admin action writes an audit row',
      auditCount >= exportedFns.length - 2,
      `${exportedFns.length} actions, ${auditCount} audit writes`,
    );

    // --- audit_logs confidentiality ---------------------------------------
    const { data: auditAsUser } = await normal.client.from('audit_logs').select('id');
    check('audit_logs are not readable by a normal user', (auditAsUser ?? []).length === 0);

    // --- suspension --------------------------------------------------------
    console.log('\nSuspension\n');

    const convo = await newConversation(normal.id);
    await admin.from('profiles').update({ suspended: true }).eq('id', normal.id);

    const suspendedAttempt = await sendChat(normal.cookie, convo, 'hello');
    check(
      'a suspended user cannot chat',
      suspendedAttempt.status === 403,
      `got ${suspendedAttempt.status}`,
    );

    // RLS must block the write even if the route check were bypassed.
    const { error: rlsWrite } = await normal.client
      .from('conversations')
      .insert({ user_id: normal.id, title: 'sneaky' });
    check('RLS blocks a suspended user from writing directly', !!rlsWrite);

    const { data: stillReads } = await normal.client
      .from('conversations')
      .select('id')
      .eq('id', convo);
    check('a suspended user can still read their history', (stillReads ?? []).length === 1);

    await admin.from('profiles').update({ suspended: false }).eq('id', normal.id);
    const afterUnsuspend = await sendChat(normal.cookie, convo, 'Reply with exactly: OK');
    check('reactivating restores chat', afterUnsuspend.text.length > 0, afterUnsuspend.error ?? '');

    // --- chat reads the DB key, not the env var ----------------------------
    console.log('\nChat uses the encrypted DB key\n');

    const target = withKeys[0];
    const original = target.encrypted_api_key!;

    try {
      // Break ONLY the database value. If chat still worked, it would prove the
      // pipeline is silently falling back to the env var.
      await admin
        .from('providers')
        .update({ encrypted_api_key: encryptSecret('sk-deliberately-invalid-key') })
        .eq('name', target.name);

      const { data: brokenModel } = await admin
        .from('models')
        .select('id, providers!inner(name)')
        .eq('providers.name', target.name)
        .eq('enabled', true)
        .limit(1)
        .single();

      const brokenConvo = await newConversation(normal.id, brokenModel!.id);
      const brokenAttempt = await sendChat(normal.cookie, brokenConvo, 'hello');

      check(
        `chat fails when only the DB key for ${target.name} is broken`,
        brokenAttempt.text.length === 0 || brokenAttempt.error !== null,
        'chat succeeded — it is still reading the env var',
      );
    } finally {
      await admin.from('providers').update({ encrypted_api_key: original }).eq('name', target.name);
    }

    // --- disabling a provider hides its models -----------------------------
    const { listAvailableModels } = await import('../lib/providers/registry');
    const before = await listAvailableModels();

    try {
      await admin.from('providers').update({ enabled: false }).eq('name', target.name);
      const during = await listAvailableModels();

      check(
        `disabling ${target.name} hides its models from the selector`,
        during.every((m) => m.providerName !== target.name) && during.length < before.length,
        `${before.length} → ${during.length}`,
      );
    } finally {
      await admin.from('providers').update({ enabled: true }).eq('name', target.name);
    }

    const after = await listAvailableModels();
    check('re-enabling restores the models', after.length === before.length);
  } finally {
    await admin.auth.admin.deleteUser(normal.id).catch(() => {});
    await admin.auth.admin.deleteUser(superuser.id).catch(() => {});
    console.log('\nTest users cleaned up.');
  }

  console.log(
    failures === 0 ? '\nAll admin checks passed.' : `\n${failures} admin check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nverify-admin crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
