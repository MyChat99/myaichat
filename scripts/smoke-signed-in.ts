/**
 * The signed-in smoke test, against a deployed site.
 *
 * `smoke` covers what an anonymous visitor sees: headers, gates, assets. This
 * covers what a user does — and it exists because the defect that took
 * production down was invisible to everything else: a Server Component calling
 * a client function, which only throws in a production build, and only for an
 * account that has an avatar.
 *
 * So this test **uploads a real avatar**. A fresh account has none, and a fresh
 * account is exactly what every other suite creates, which is why 34 green
 * suites sat alongside a 500.
 *
 *   npm run smoke:signed-in
 *   npm run smoke:signed-in -- --base=http://localhost:3100
 */
import { mkdirSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';

import type { Database } from '../lib/db/types';
import { buildPng } from './_fixtures';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const BASE = arg('base', 'https://myaichat-production.up.railway.app');
const OUT = arg('out', 'docs/screenshots/smoke');
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'smoke-plate-folio-2610';

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

/** Waits for the streamed answer to finish, or gives up. */
async function waitForAnswer(page: Page, timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let sawCaret = false;
  while (Date.now() < deadline) {
    const streaming = (await page.locator('[data-press="caret"]').count()) > 0;
    if (streaming) sawCaret = true;
    if (sawCaret && !streaming) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const email = `smoke-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !created) throw error ?? new Error('could not create the smoke account');
  const userId = created.user.id;

  const browser = await chromium.launch();

  try {
    console.log(`Smoke test — ${BASE}\n`);

    /**
     * A real avatar, uploaded through the app's own presign + PUT path, not a
     * fabricated key. A fabricated key exercises the server render but leaves a
     * broken image; this proves the whole portrait path end to end.
     */
    const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (!signIn?.session) throw new Error('could not sign in the smoke account');
    const cookieValue = `base64-${Buffer.from(JSON.stringify(signIn.session)).toString('base64')}`;
    const cookieHeader = `sb-${projectRef}-auth-token=${cookieValue}`;

    const presign = await fetch(`${BASE}/api/uploads/presign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({
        filename: 'portrait.png',
        mimeType: 'image/png',
        sizeBytes: 512,
        scope: 'avatar',
      }),
    });
    const presigned = await presign.json().catch(() => null);
    check('an avatar upload can be presigned', presign.ok, `${presign.status}`);

    if (presigned?.uploadUrl) {
      const png = buildPng(64);
      const put = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        // `Uint8Array`, not `Buffer`: Node's fetch types accept the former.
        body: new Uint8Array(png),
      });
      check('and the bucket accepts the avatar', put.ok, `${put.status}`);
      await admin.from('profiles').update({ avatar_url: presigned.key }).eq('id', userId);
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .single();
    check(
      'the account really has an avatar — the path that broke production',
      Boolean(profile?.avatar_url),
      String(profile?.avatar_url),
    );

    // ── signed out ────────────────────────────────────────────────────────
    console.log('\nSigned out\n');
    const anonContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const anonPage = await anonContext.newPage();
    const loginResponse = await anonPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    check('/login loads', loginResponse?.status() === 200, `${loginResponse?.status()}`);
    await anonPage.screenshot({ path: `${OUT}/1-login.png` });
    await anonContext.close();

    // ── signed in, WITH an avatar ─────────────────────────────────────────
    console.log('\nSigned in, with an avatar\n');
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        domain: new URL(BASE).hostname,
        path: '/',
      },
    ]);
    const page = await context.newPage();
    /**
     * Kept at full length and truncated only when printed. Slicing on capture
     * silently defeats any later `.test()` against them — a CSP violation puts
     * the whole blocked URL first and does not reach the words "Content
     * Security Policy" until well past 140 characters.
     */
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    const short = (s: string | undefined) => (s ? s.slice(0, 160) : '');

    const home = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    check('/ loads', home?.status() === 200, `${home?.status()}`);
    const body = await page.content();
    check('and shows no boundary violation', !/Attempted to call/.test(body));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/2-signed-in.png` });

    /**
     * The avatar has to have DECODED, not merely be on the page.
     *
     * This is the check that would have caught ISSUE-065 from the outside. That
     * bug shipped an `<img>` whose src was our own origin — so it was present,
     * had a src, and laid out — pointing at a route that 302s to R2. CSP is
     * evaluated after the redirect, the image was blocked, and every assertion
     * about the markup still passed.
     *
     * `naturalWidth` is the only honest signal: it is 0 until the bytes have
     * arrived and decoded. It is also stronger than the console-error check
     * below, which depends on the browser choosing to log something.
     *
     * Strings, not closures, in `page.evaluate` — tsx/esbuild `keepNames`
     * rewrites named functions to `__name(...)`, which does not exist in the
     * browser.
     */
    const images = (await page.evaluate(
      `Array.from(document.images).map(i => ({ src: i.currentSrc || i.src, w: i.naturalWidth }))`,
    )) as { src: string; w: number }[];

    const avatarImages = images.filter((i) => /uploads\/download|avatar/i.test(i.src));
    check(
      'the avatar is actually on the page',
      avatarImages.length > 0,
      `${images.length} image(s), none avatar-shaped`,
    );
    check(
      'and it DECODED — not blocked, not broken',
      avatarImages.length > 0 && avatarImages.every((i) => i.w > 0),
      avatarImages.map((i) => `${i.w}px ${i.src.slice(0, 60)}`).join(' | '),
    );
    check(
      'and nothing was refused by our own CSP',
      !consoleErrors.some((e) => /Content Security Policy/i.test(e)),
      short(consoleErrors.find((e) => /Content Security Policy/i.test(e))),
    );

    // ── a message through each enabled provider ───────────────────────────
    console.log('\nA message through each configured provider\n');

    const { data: models } = await admin
      .from('models')
      .select('id, display_name, providers!inner(name, key_last4, enabled)')
      .eq('enabled', true)
      .eq('providers.enabled', true)
      .not('providers.key_last4', 'is', null);

    const byProvider = new Map<string, { id: string; display_name: string }>();
    for (const m of models ?? []) {
      if (!byProvider.has(m.providers.name)) byProvider.set(m.providers.name, m);
    }
    check('at least one provider is configured', byProvider.size > 0, `${byProvider.size}`);

    let conversationId: string | null = null;
    for (const [providerName, model] of byProvider) {
      const { data: convo } = await admin
        .from('conversations')
        .insert({ user_id: userId, title: `Smoke ${providerName}`, model_id: model.id })
        .select('id')
        .single();
      conversationId = convo!.id;

      await page.goto(`${BASE}/c/${convo!.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await page.fill('textarea', 'Reply with exactly the word: ready');
      await page.click('[data-press="quill"]');

      const finished = await waitForAnswer(page);
      const { data: replies } = await admin
        .from('messages')
        .select('content')
        .eq('conversation_id', convo!.id)
        .eq('role', 'assistant');

      check(
        `${providerName} (${model.display_name}) answered`,
        finished && (replies ?? []).length > 0,
        `${(replies ?? []).length} reply/replies`,
      );
    }

    // ── history persists ──────────────────────────────────────────────────
    console.log('\nHistory, stopping, and the numbers\n');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const messagesAfterReload = await page.locator('[data-message]').count();
    check('history survives a reload', messagesAfterReload >= 2, `${messagesAfterReload} messages`);

    // ── stop mid-stream ───────────────────────────────────────────────────
    await page.fill('textarea', 'Write a long, detailed history of the printing press.');
    await page.click('[data-press="quill"]');
    // Let it genuinely start before stopping it.
    for (let i = 0; i < 40; i++) {
      if ((await page.locator('[data-press="caret"]').count()) > 0) break;
      await page.waitForTimeout(250);
    }
    const started = (await page.locator('[data-press="caret"]').count()) > 0;
    await page.waitForTimeout(1200);
    await page.click('[data-press="quill"]'); // the same control reads "Stop" while streaming
    await page.waitForTimeout(2500);
    const stopped = (await page.locator('[data-press="caret"]').count()) === 0;
    check(
      'a stream can be started and stopped',
      started && stopped,
      `started=${started} stopped=${stopped}`,
    );

    const { data: partial } = await admin
      .from('messages')
      .select('content')
      .eq('conversation_id', conversationId!)
      .eq('role', 'assistant');
    check(
      'and the partial answer is kept rather than discarded',
      (partial ?? []).length >= 2,
      `${(partial ?? []).length} assistant messages`,
    );

    // ── usage recorded ────────────────────────────────────────────────────
    const { count: usageRows } = await admin
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    check('usage rows were written', (usageRows ?? 0) > 0, `${usageRows} rows`);

    // ── admin spend panel ─────────────────────────────────────────────────
    console.log('\nAdmin\n');
    await admin.from('profiles').update({ role: 'admin' }).eq('id', userId);
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const adminText = await page.evaluate('document.body.innerText');
    check(
      '/admin shows spend against the ceiling',
      /ceiling/i.test(String(adminText)),
      String(adminText).replace(/\n+/g, ' ').slice(0, 120),
    );
    check(
      'and states the sign-up posture',
      /sign-ups are (open|closed)|limited to/i.test(String(adminText)),
    );
    await page.screenshot({ path: `${OUT}/3-admin.png` });

    check(
      'no console errors anywhere in the walk',
      consoleErrors.length === 0,
      short(consoleErrors[0]),
    );

    await context.close();
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\nSmoke account removed.');
  }

  console.log(
    failures === 0
      ? `\nSigned-in smoke test passed against ${BASE}. Screenshots in ${OUT}/`
      : `\n${failures} smoke check(s) FAILED against ${BASE}.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('smoke-signed-in crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
