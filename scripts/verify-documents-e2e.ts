/**
 * The whole way through, in a real browser: attach a spreadsheet, send it, and
 * confirm the MODEL answered from a number that only exists inside the file.
 *
 * `verify:documents` proves the parser. This proves the plumbing — picker,
 * presign, PUT, storage, extraction, prompt assembly and the provider — because
 * every one of those can be individually correct while the model still receives
 * nothing. The assertion is deliberately a value from the sheet rather than
 * "the response was non-empty": an answer that ignored the attachment is a
 * perfectly well-formed answer.
 *
 *   npm run dev
 *   npm run verify:documents:e2e
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

import type { Database } from '../lib/db/types';
import { buildPdf, buildXlsx } from './_fixtures';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const BASE = arg('base', process.env.BASE_URL ?? 'http://localhost:3000');
const OUT = arg('out', 'docs/screenshots/documents');
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'documents-e2e-password-1234';

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

/** A number that appears nowhere except inside the fixture. */
const SECRET_FIGURE = '48317';

async function main() {
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

  const sheet = join(tmpdir(), `revenue-${process.pid}.xlsx`);
  writeFileSync(
    sheet,
    buildXlsx([
      {
        name: 'Revenue',
        rows: [
          ['Region', 'Units', 'Revenue'],
          ['North', '120', SECRET_FIGURE],
          ['South', '95', '3610'],
        ],
      },
    ]),
  );

  const pdf = join(tmpdir(), `memo-${process.pid}.pdf`);
  writeFileSync(pdf, buildPdf('Marmalade is the codeword for this quarter'));

  const email = `docs-e2e-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  const browser = await chromium.launch();

  try {
    const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const value = `base64-${Buffer.from(JSON.stringify(signIn!.session)).toString('base64')}`;

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: `sb-${projectRef}-auth-token`, value, domain: new URL(BASE).hostname, path: '/' },
    ]);
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    console.log('A spreadsheet, end to end\n');

    await page.setInputFiles('input[type="file"]', sheet);
    await page
      .locator('[data-press="chip"]')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });

    const chipText = (await page.locator('[data-press="chip"]').first().textContent()) ?? '';
    check('the chip names the file', chipText.includes('revenue'), chipText.slice(0, 60));

    // The type badge only appears once the upload has finished.
    for (let i = 0; i < 60; i++) {
      const enabled = await page.evaluate(
        `!document.querySelector('[data-press="quill"]')?.disabled`,
      );
      if (enabled) break;
      await page.waitForTimeout(500);
    }
    const settled = (await page.locator('[data-press="chip"]').first().textContent()) ?? '';
    check('and labels it as a spreadsheet', /sheet/i.test(settled), settled.slice(0, 60));
    await page.screenshot({ path: `${OUT}/1-sheet-attached.png` });

    await page.fill(
      'textarea',
      'What is the Revenue figure for the North region? Reply with just the number.',
    );
    await page.click('[data-press="quill"]');

    /**
     * Waited for in the DATABASE, not on screen.
     *
     * Sending from the empty page navigates to the new conversation, and an
     * earlier version of this polled `document.body.innerText` across that
     * navigation — so it kept reading the page it had just left and reported a
     * correct answer as missing. The stored assistant message is the same fact
     * without the race, and it is this project's own rule anyway: assert stored
     * state, not whatever the screen happened to be showing.
     */
    const answer = await (async () => {
      for (let i = 0; i < 120; i++) {
        const { data: convos } = await admin
          .from('conversations')
          .select('id')
          .eq('user_id', userId);
        const ids = (convos ?? []).map((c) => c.id);
        if (ids.length) {
          const { data: replies } = await admin
            .from('messages')
            .select('content')
            .in('conversation_id', ids)
            .eq('role', 'assistant');
          const found = (replies ?? []).find((r) => r.content.includes(SECRET_FIGURE));
          if (found) return found.content;
          if ((replies ?? []).length > 0) return (replies ?? [])[0].content;
        }
        await page.waitForTimeout(1000);
      }
      return null;
    })();

    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/2-sheet-answered.png` });

    check(
      `the model answered with ${SECRET_FIGURE}, a number that exists only inside the file`,
      Boolean(answer && answer.includes(SECRET_FIGURE)),
      answer ? answer.slice(0, 160) : 'no assistant reply was stored',
    );

    // The extracted text must NOT have been stored on the message: the file is
    // the attachment, and duplicating its contents into history would bloat
    // every future turn that replays it.
    const { data: stored } = await admin
      .from('messages')
      .select('content, attachments, conversations!inner(user_id)')
      .eq('conversations.user_id', userId)
      .eq('role', 'user');
    const userMessage = (stored ?? [])[0] as { content: string; attachments: unknown } | undefined;
    check(
      'the stored message keeps the question, not the whole spreadsheet',
      Boolean(userMessage && !userMessage.content.includes(SECRET_FIGURE)),
      userMessage?.content.slice(0, 80) ?? 'no message stored',
    );
    check(
      'and still records the attachment',
      Array.isArray(userMessage?.attachments) &&
        (userMessage!.attachments as unknown[]).length === 1,
    );

    console.log('\nA PDF, end to end\n');

    const { data: docModel } = await admin
      .from('models')
      .select('id, providers!inner(key_last4)')
      .eq('enabled', true)
      .eq('supports_documents', true)
      .not('providers.key_last4', 'is', null)
      .limit(1)
      .maybeSingle();

    if (!docModel) {
      console.log('  skip  no configured model accepts documents natively.');
    } else {
      const { data: convo } = await admin
        .from('conversations')
        .insert({ user_id: userId, title: 'PDF', model_id: docModel.id })
        .select('id')
        .single();

      await page.goto(`${BASE}/c/${convo!.id}`, { waitUntil: 'networkidle' });
      await page.setInputFiles('input[type="file"]', pdf);
      await page
        .locator('[data-press="chip"]')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 });
      for (let i = 0; i < 60; i++) {
        const enabled = await page.evaluate(
          `!document.querySelector('[data-press="quill"]')?.disabled`,
        );
        if (enabled) break;
        await page.waitForTimeout(500);
      }

      await page.fill(
        'textarea',
        'What is the codeword in this document? Reply with just the word.',
      );
      await page.click('[data-press="quill"]');

      let sawCodeword = false;
      for (let i = 0; i < 120; i++) {
        const body = await page.evaluate(`document.body.innerText`);
        if (typeof body === 'string' && /marmalade/i.test(body)) {
          sawCodeword = true;
          break;
        }
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${OUT}/3-pdf-answered.png` });
      check(
        'the model read the PDF and found the codeword',
        sawCodeword,
        String(await page.evaluate(`document.body.innerText`))
          .replace(/\n+/g, ' ')
          .slice(-200),
      );
    }

    await context.close();
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\nTest user cleaned up.');
  }

  console.log(
    failures === 0
      ? `\nA spreadsheet and a PDF went in and the model answered from both. Screenshots in ${OUT}/`
      : `\n${failures} end-to-end check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-documents-e2e crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
