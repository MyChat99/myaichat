/**
 * Proves a file goes from the browser to storage and into a stored message.
 *
 * `verify:storage` proves the credentials work from the SERVER, and
 * `verify:attachments` proves the validation rules. Neither exercises the one
 * step that has never been tested: the browser's own PUT to the bucket, which
 * is the only thing that depends on the bucket's CORS configuration. That has
 * been the outstanding Phase 6 human check since the credentials landed.
 *
 * So this drives a real browser: attach a file, wait for the upload to
 * complete, send the message, and then assert against the DATABASE that the
 * message was stored with the attachment on it. Asserting on the UI would only
 * prove the UI drew a chip.
 *
 *   npm run verify:upload
 *   npm run verify:upload -- --base=https://…
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const BASE = arg('base', process.env.BASE_URL ?? 'http://localhost:3000');
const OUT = arg('out', 'docs/screenshots/upload');
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'upload-test-password-1234';
const CHUNK = 3180;

const admin = createClient<Database>(url, SECRET_KEY(), {
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

/**
 * A real PNG, encoded here rather than committed as a base64 blob.
 *
 * Size matters: a 1×1 or 8×8 image is a valid PNG that the vision endpoint
 * refuses with "Could not process image", so a tiny fixture tests the upload
 * and then fails the leg it was meant to prove. 256×256 is unambiguously an
 * image. Written as an encoder because a magic base64 string is a fixture
 * nobody can check — this one is a few lines of PNG, and its dimensions are
 * visible in the source.
 */
function writePng(path: string, size = 256) {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])) >>> 0, 0);
    return Buffer.concat([head, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB

  // Diagonal bands, so the image has actual content rather than one flat field.
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let at = 0;
  for (let y = 0; y < size; y++) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const band = ((x + y) >> 5) % 2 === 0;
      raw[at++] = band ? 0xf1 : 0x3d;
      raw[at++] = band ? 0xee : 0x55;
      raw[at++] = band ? 0xe2 : 0x88;
    }
  }

  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function main() {
  /**
   * The same four variables `isStorageConfigured()` reads, checked directly:
   * that module is `server-only` and cannot be imported from a script.
   */
  const storageConfigured = Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME,
  );

  if (!storageConfigured) {
    console.log('\n  skip  storage is not configured in this environment.\n');
    process.exit(0);
  }

  mkdirSync(OUT, { recursive: true });
  const file = join(tmpdir(), `upload-check-${process.pid}.png`);
  writePng(file);

  const email = `upload-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  try {
    const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const value = `base64-${Buffer.from(JSON.stringify(signIn!.session)).toString('base64')}`;
    const name = `sb-${projectRef}-auth-token`;
    const domain = new URL(BASE).hostname;
    const cookies =
      value.length <= CHUNK
        ? [{ name, value, domain, path: '/' }]
        : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, n) => ({
            name: `${name}.${n}`,
            value: value.slice(n * CHUNK, (n + 1) * CHUNK),
            domain,
            path: '/',
          }));

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    await context.addCookies(cookies);
    const page = await context.newPage();

    // The PUT to the bucket is a cross-origin request. If CORS is wrong it
    // fails here and nowhere else, so the failure is worth naming.
    const bucketPuts: { status: number; url: string }[] = [];
    page.on('response', (r) => {
      if (r.request().method() === 'PUT' && !r.url().includes(new URL(BASE).host)) {
        bucketPuts.push({ status: r.status(), url: r.url().split('?')[0] });
      }
    });

    // A failed cross-origin PUT reports as a request failure with no response,
    // so listening for responses alone would show nothing at all.
    const failed: string[] = [];
    page.on('requestfailed', (r) => {
      failed.push(`${r.method()} ${r.url().split('?')[0]} — ${r.failure()?.errorText ?? 'failed'}`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') failed.push(`console: ${m.text().slice(0, 200)}`);
    });

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    const clip = page.locator('[data-press="clip"]');
    check('the paperclip is present', (await clip.count()) > 0);
    check('the paperclip is enabled', !(await clip.first().isDisabled()));

    await page.setInputFiles('input[type="file"]', file);

    // The chip appears immediately and the upload finishes behind it.
    const chip = page.locator('[data-press="chip"]').first();
    await chip.waitFor({ state: 'visible', timeout: 15_000 });
    check('an attachment chip is rendered', true);
    await page.screenshot({ path: `${OUT}/1-attached.png` });

    // Send only becomes possible once the file is up.
    const send = page.locator('[data-press="quill"]');
    await page
      .waitForFunction(`!document.querySelector('[data-press="quill"]')?.disabled`, undefined, {
        timeout: 30_000,
      })
      .catch(() => {
        console.error('\n  the upload never completed. Network detail:');
        for (const f of [...new Set(failed)]) console.error(`    ${f}`);
        for (const p of bucketPuts) console.error(`    PUT ${p.status} ${p.url}`);
      });
    check(
      'the browser PUT the file to the bucket',
      bucketPuts.length > 0,
      failed.length ? failed.join(' | ') : 'no cross-origin PUT was observed — CORS or presigning',
    );
    check(
      'the bucket accepted it',
      bucketPuts.every((p) => p.status >= 200 && p.status < 300),
      bucketPuts.map((p) => p.status).join(', '),
    );

    await page.fill('textarea', 'Describe this image in one short sentence.');
    await send.click();

    // Assert against stored state, not the screen.
    let stored: { content: string; attachments: unknown }[] = [];
    for (let i = 0; i < 40; i++) {
      const { data } = await admin
        .from('messages')
        .select('content, attachments, conversation_id, conversations!inner(user_id)')
        .eq('conversations.user_id', userId)
        .eq('role', 'user');
      stored = (data ?? []) as typeof stored;
      if (stored.length > 0) break;
      await page.waitForTimeout(500);
    }

    check('the message was stored', stored.length > 0);
    const attachments = (stored[0]?.attachments ?? []) as { key?: string }[];
    check(
      'the stored message carries the attachment',
      Array.isArray(attachments) && attachments.length > 0 && Boolean(attachments[0]?.key),
      JSON.stringify(stored[0]?.attachments ?? null),
    );

    /**
     * The model leg. Asserted from the database rather than the screen, and
     * asserted at all because "the file uploaded" and "the model could read it"
     * are different claims — an image the vision endpoint refuses still stores
     * perfectly. A 1×1 fixture passed every check above and came back
     * "Could not process image", which is why the fixture is now 256px.
     */
    let reply = '';
    for (let i = 0; i < 60; i++) {
      const { data } = await admin
        .from('messages')
        .select('content, role, conversations!inner(user_id)')
        .eq('conversations.user_id', userId)
        .eq('role', 'assistant');
      reply = (data ?? [])[0]?.content ?? '';
      if (reply.trim().length > 0) break;
      await page.waitForTimeout(500);
    }
    check(
      'the model answered about the attached image',
      reply.trim().length > 0,
      'no assistant message was stored — the provider rejected the image',
    );
    if (reply) console.log(`        ↳ "${reply.slice(0, 90).replace(/\s+/g, ' ')}…"`);

    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/2-sent.png` });

    // And the object is really in the bucket, read back through the app's own
    // download route rather than the vendor SDK.
    if (attachments[0]?.key) {
      const download = await page.request.get(
        `${BASE}/api/uploads/download?key=${encodeURIComponent(attachments[0].key)}`,
      );
      check('the stored object can be read back', download.ok(), `HTTP ${download.status()}`);
    }

    await browser.close();
  } finally {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(
    failures === 0
      ? `\nBrowser → bucket → message round trip works. Screenshots in ${OUT}/`
      : `\n${failures} upload check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-upload crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
