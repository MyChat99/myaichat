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

/** A tiny valid PNG, written at runtime rather than committed as a fixture. */
function writePng(path: string) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHUlEQVQoU2NkYGD4z0AEYBxVSF' +
      'AwGjAaMBowGjAaMBoAAJ7fA/9Ck3AhAAAAAElFTkSuQmCC',
    'base64',
  );
  writeFileSync(path, png);
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

    await page.fill('textarea', 'What is in this image?');
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

    await page.waitForTimeout(2500);
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
