/**
 * Proves the Phase 6 criteria that do NOT need credentials.
 *
 * R2 and Resend are unconfigured here, so the happy paths (a real upload, a
 * real send) are NOT covered — those are marked NEEDS HUMAN VERIFICATION in
 * PROGRESS.md rather than faked.
 *
 * What IS covered is every rejection path the phase file asks for:
 * unauthorised, oversized, wrong type, someone else's object, and a model that
 * cannot read the attachment. Email templates live in verify:email — the two
 * cannot share a process (see that file's header).
 *
 *   npm run dev              # in another terminal
 *   npm run verify:storage
 */
import { createClient, type Session } from '@supabase/supabase-js';

import type { Database } from '../lib/db/types';
import {
  ALLOWED_MIME,
  buildObjectKey,
  isStorageConfigured,
  keyBelongsToUser,
} from '../lib/r2/storage';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const CHUNK_SIZE = 3180;

const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = process.pid;
const PASSWORD = 'storage-test-password-1234';

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

async function presign(cookie: string | null, body: unknown) {
  const res = await fetch(`${BASE_URL}/api/uploads/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  console.log('Object keys and validation\n');

  const userA = '11111111-1111-1111-1111-111111111111';
  const userB = '22222222-2222-2222-2222-222222222222';

  const key = buildObjectKey(userA, 'chat', 'photo.png');
  check('object keys are namespaced by user', key.startsWith(`chat/${userA}/`), key);
  check('object keys are unguessable', /[0-9a-f-]{36}\.png$/.test(key), key);
  check('a key belongs to its owner', keyBelongsToUser(key, userA));
  check('a key does NOT belong to another user', !keyBelongsToUser(key, userB));
  check(
    'a crafted prefix cannot impersonate another user',
    !keyBelongsToUser(`chat/${userA}/../${userB}/x.png`, userB),
  );

  check('the MIME allow-list is an allow-list', !('application/x-msdownload' in ALLOWED_MIME));
  check('images are allowed', ALLOWED_MIME['image/png']?.kind === 'image');
  check('pdf is a document', ALLOWED_MIME['application/pdf']?.kind === 'document');

  console.log('\nHTTP rejection paths\n');

  try {
    await fetch(BASE_URL, { redirect: 'manual' });
  } catch {
    console.error(`\nCannot reach ${BASE_URL}. Start the dev server first (npm run dev).`);
    process.exit(1);
  }

  const email = `storage-${stamp}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const userClient = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn } = await userClient.auth.signInWithPassword({ email, password: PASSWORD });
  const cookie = sessionCookie(signIn!.session!);

  try {
    const anon = await presign(null, {
      filename: 'x.png',
      mimeType: 'image/png',
      sizeBytes: 1000,
    });
    check('unauthenticated upload is rejected', anon.status === 401, `got ${anon.status}`);

    const badType = await presign(cookie, {
      filename: 'evil.exe',
      mimeType: 'application/x-msdownload',
      sizeBytes: 1000,
    });
    check('a disallowed MIME type is rejected', badType.status === 415, `got ${badType.status}`);

    const oversized = await presign(cookie, {
      filename: 'huge.png',
      mimeType: 'image/png',
      sizeBytes: 500 * 1024 * 1024,
    });
    check('an oversized file is rejected', oversized.status === 413, `got ${oversized.status}`);

    const avatarPdf = await presign(cookie, {
      filename: 'not-an-image.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      scope: 'avatar',
    });
    check('a non-image avatar is rejected', avatarPdf.status === 415, `got ${avatarPdf.status}`);

    // Valid request: 503 while unconfigured proves validation ran FIRST and that
    // storage absence is reported distinctly rather than as a validation error.
    const valid = await presign(cookie, {
      filename: 'ok.png',
      mimeType: 'image/png',
      sizeBytes: 1000,
    });
    if (isStorageConfigured()) {
      check(
        'a valid request returns an upload URL',
        valid.status === 200 && !!valid.body?.uploadUrl,
      );
    } else {
      check(
        'a valid request reports storage as unconfigured (not a validation error)',
        valid.status === 503 && valid.body?.code === 'storage_unconfigured',
        `got ${valid.status}`,
      );
    }

    // Downloads
    const foreignKey = `chat/${'99999999-9999-9999-9999-999999999999'}/x.png`;
    const foreign = await fetch(
      `${BASE_URL}/api/uploads/download?key=${encodeURIComponent(foreignKey)}`,
      { headers: { cookie }, redirect: 'manual' },
    );
    check(
      "another user's object is not downloadable",
      foreign.status === 404,
      `got ${foreign.status}`,
    );

    const anonDownload = await fetch(
      `${BASE_URL}/api/uploads/download?key=${encodeURIComponent(`chat/${created.user.id}/x.png`)}`,
      { redirect: 'manual' },
    );
    check(
      'unauthenticated download is rejected',
      anonDownload.status === 401,
      `got ${anonDownload.status}`,
    );

    // Capability refusal — a text-only model must refuse an image rather than
    // silently dropping it.
    const { data: model } = await admin
      .from('models')
      .select('id, display_name')
      .eq('supports_vision', false)
      .eq('enabled', true)
      .limit(1)
      .maybeSingle();

    if (model) {
      const { data: convo } = await admin
        .from('conversations')
        .insert({ user_id: created.user.id, title: 'cap test', model_id: model.id })
        .select('id')
        .single();

      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          conversationId: convo!.id,
          message: 'what is in this image?',
          attachments: [
            {
              key: `chat/${created.user.id}/x.png`,
              name: 'x.png',
              mimeType: 'image/png',
              sizeBytes: 100,
              kind: 'image',
            },
          ],
        }),
        redirect: 'manual',
      });
      check(
        'a non-vision model refuses an image rather than dropping it',
        res.status === 422,
        `got ${res.status}`,
      );
    } else {
      console.log('  skip  capability refusal — every enabled model supports vision');
    }
  } finally {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    console.log('\nTest user cleaned up.');
  }

  console.log(failures === 0 ? '\nAll storage checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nverify-storage crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
