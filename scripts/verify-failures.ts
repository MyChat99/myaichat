/**
 * What a person actually SEES when something goes wrong.
 *
 * `verify:degradation` proves an error maps to the right status and leaks
 * nothing. That is a different question from whether the user is told anything
 * at all: a route can return a correct, well-shaped 429 that renders as a
 * message that never appears, or as a spinner that never stops.
 *
 * So every failure here is induced for real — the account is suspended, the
 * budget is spent, the limit is set to one — and the assertion is that a human
 * reading the screen learns what happened and what to do about it, without
 * being shown anything they should not see.
 *
 * Every setting this touches is captured first and restored in `finally`,
 * including on failure.
 *
 *   npm run dev
 *   npm run verify:failures
 */
import { mkdirSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';

import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = 'docs/screenshots/failures';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'failures-test-password-1234';

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
 * Anything a message must never contain, whatever went wrong upstream.
 * A user-facing failure that names our storage paths, our vendor, or a stack
 * frame has turned an outage into an information leak.
 */
const FORBIDDEN =
  /sk-|Bearer |api[_-]?key|at Object\.|node_modules|\/var\/|supabase\.co|[0-9a-f]{8}-[0-9a-f]{4}-/i;

function clean(text: string): boolean {
  return !FORBIDDEN.test(text);
}

/**
 * Anything the app said out loud about a FAILURE: alerts, toasts, inline errors.
 *
 * Deliberately not `role="status"`. That role is for progress, and the chat
 * page uses it for "Loading conversation…" — which this collector happily
 * returned as the app's answer to a spent budget, passing the "it said
 * something" check and failing the one that reads what it said.
 */
const VISIBLE_MESSAGES = `(() => {
  const nodes = Array.from(
    document.querySelectorAll('[role="alert"], [data-sonner-toast], [data-press="compare-error"]'),
  );
  return nodes
    .filter(function (el) {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    })
    .map(function (el) { return (el.textContent || '').trim(); })
    .filter(Boolean);
})()`;

async function saidAnything(page: Page): Promise<string[]> {
  return (await page.evaluate(VISIBLE_MESSAGES)) as string[];
}

/** Waits for the app to say something, rather than for a fixed delay. */
async function waitForMessage(page: Page, timeoutMs = 30_000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await saidAnything(page);
    if (messages.length > 0) return messages;
    if (Date.now() > deadline) return [];
    await page.waitForTimeout(400);
  }
}

type Setting = { key: string; value: unknown | null };

async function readSetting(key: string): Promise<Setting> {
  const { data } = await admin.from('system_settings').select('value').eq('key', key).maybeSingle();
  return { key, value: data?.value ?? null };
}

async function writeSetting(key: string, value: unknown) {
  await admin.from('system_settings').upsert({ key, value: value as never }, { onConflict: 'key' });
}

async function restoreSetting(setting: Setting) {
  if (setting.value === null) await admin.from('system_settings').delete().eq('key', setting.key);
  else await writeSetting(setting.key, setting.value);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const email = `failures-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  const cookieValue = `base64-${Buffer.from(JSON.stringify(signIn!.session)).toString('base64')}`;

  const budgetBefore = await readSetting('daily_token_budget_per_user');
  const rateBefore = await readSetting('rate_limit_messages_per_hour');

  const browser = await chromium.launch();

  const newPage = async (signedIn: boolean) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
    });
    if (signedIn) {
      await context.addCookies([
        {
          name: `sb-${projectRef}-auth-token`,
          value: cookieValue,
          domain: new URL(BASE_URL).hostname,
          path: '/',
        },
      ]);
    }
    return { context, page: await context.newPage() };
  };

  try {
    /**
     * The leak detector, checked against known-bad strings before it is trusted.
     *
     * Every "and it leaks nothing" assertion below is only as good as this
     * regex, and a regex that matches nothing passes every one of them. This
     * makes weakening it a visible failure rather than a silent all-clear.
     */
    console.log('The leak detector detects\n');
    const LEAKY = [
      'Invalid api_key provided: sk-proj-abcdef',
      'Authorization: Bearer eyJhbGciOi',
      'ENOENT: /var/task/.next/server/app',
      'at Object.<anonymous> (/app/node_modules/x/index.js:1:1)',
      'failed to read 3f8a1c2d-9b4e-4f21-a0c7-1d2e3f4a5b6c/photo.png',
    ];
    check(
      'every known-bad string is rejected',
      LEAKY.every((sample) => !clean(sample)),
      LEAKY.filter(clean).join(' | '),
    );
    check(
      'and an ordinary message is not',
      clean('Hourly limit of 60 messages reached. Try again in 12 minutes.'),
    );

    console.log('\nSigning in with the wrong password\n');
    {
      const { context, page } = await newPage(false);
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
      await page.fill('#email', email);
      await page.fill('#password', 'definitely-not-the-password');
      await page.click('button[type="submit"]');

      const messages = await waitForMessage(page, 20_000);
      await page.screenshot({ path: `${OUT}/wrong-password.png` });

      check('the user is told the sign-in failed', messages.length > 0, 'the page said nothing');
      check(
        'and the message leaks nothing',
        messages.every(clean),
        messages.join(' | ').slice(0, 120),
      );

      /**
       * The message must not distinguish "no such account" from "wrong
       * password" — that difference turns the login form into a way to test
       * whether an address is registered here.
       */
      await page.fill('#email', `definitely-not-registered-${process.pid}@example.com`);
      await page.fill('#password', 'definitely-not-the-password');
      await page.click('button[type="submit"]');
      const unknownAccount = await waitForMessage(page, 20_000);

      check(
        'an unknown address gets the same message as a wrong password',
        unknownAccount.length > 0 && unknownAccount.join('|') === messages.join('|'),
        `"${messages.join('|').slice(0, 60)}" vs "${unknownAccount.join('|').slice(0, 60)}"`,
      );
      await context.close();
    }

    console.log('\nThe daily budget is already spent\n');
    {
      /**
       * Spent, not merely small.
       *
       * The budget refuses a turn once the day's usage has *reached* the
       * limit — it does not try to predict whether the next turn will cross it,
       * so setting the limit to 1 token with nothing spent yet still allows one
       * turn. (`/api/compare` does refuse up front, because it commits N turns
       * at once and the overshoot is unbounded; a single chat turn overshoots
       * by at most one reply.) My first version of this check set the limit and
       * sent immediately, which tested nothing and looked like a bug in the
       * route.
       *
       * So the day's usage is seeded past the line first.
       */
      await writeSetting('daily_token_budget_per_user', 100);
      const { data: seeded } = await admin
        .from('usage_logs')
        .insert({
          user_id: userId,
          model_id: null,
          input_tokens: 500,
          output_tokens: 500,
          estimated_cost: 0,
        })
        .select('id')
        .single();

      const { context, page } = await newPage(true);
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await page.fill('textarea', 'Say hello');
      await page.click('[data-press="quill"]');

      const messages = await waitForMessage(page);
      await page.screenshot({ path: `${OUT}/budget-spent.png` });

      check('the user is told the budget is spent', messages.length > 0, 'the page said nothing');
      check(
        'and is told when it resets, so the message is actionable',
        messages.some((m) => /reset/i.test(m)),
        messages.join(' | ').slice(0, 140),
      );
      check('and it leaks nothing', messages.every(clean), messages.join(' | ').slice(0, 120));

      const { count } = await admin
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      check(
        'and the refusal itself spent nothing',
        (count ?? 0) === 1,
        `${count} usage row(s), expected only the seeded one`,
      );

      await context.close();
      await admin.from('usage_logs').delete().eq('id', seeded!.id);
      await restoreSetting(budgetBefore);
    }

    console.log('\nThe hourly limit is reached\n');
    {
      await writeSetting('rate_limit_messages_per_hour', 1);

      const { context, page } = await newPage(true);
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });

      // The first turn consumes the single allowance; the second must refuse.
      await page.fill('textarea', 'Reply with exactly: one');
      await page.click('[data-press="quill"]');
      await page.waitForTimeout(12_000);
      await page.fill('textarea', 'Reply with exactly: two');
      await page.click('[data-press="quill"]');

      const messages = await waitForMessage(page);
      await page.screenshot({ path: `${OUT}/rate-limited.png` });

      check('the user is told they hit the limit', messages.length > 0, 'the page said nothing');
      check(
        'and the message names the limit rather than saying "error"',
        messages.some((m) => /limit/i.test(m)),
        messages.join(' | ').slice(0, 140),
      );
      check('and it leaks nothing', messages.every(clean), messages.join(' | ').slice(0, 120));

      await context.close();
      await restoreSetting(rateBefore);
    }

    console.log('\nThe account has been suspended\n');
    {
      await admin.from('profiles').update({ suspended: true }).eq('id', userId);

      /**
       * Counted as a delta. The rate-limit section above deliberately completes
       * one turn, so an absolute count of this user's messages is already 2
       * when this section starts and says nothing about the suspension.
       */
      const messageCount = async () => {
        const { data: convos } = await admin
          .from('conversations')
          .select('id')
          .eq('user_id', userId);
        const ids = (convos ?? []).map((c) => c.id);
        if (ids.length === 0) return 0;
        const { count } = await admin
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .in('conversation_id', ids);
        return count ?? 0;
      };
      const before = await messageCount();

      const { context, page } = await newPage(true);
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await page.fill('textarea', 'Say hello');
      await page.click('[data-press="quill"]');

      const messages = await waitForMessage(page);
      await page.screenshot({ path: `${OUT}/suspended.png` });

      check('a suspended user is told so', messages.length > 0, 'the page said nothing');

      /**
       * The banner is on screen from page load, so seeing it proves nothing
       * about the send being refused. What proves it: no message was stored.
       */
      const after = await messageCount();
      check(
        'and the send is actually refused, not merely discouraged',
        after === before,
        `${after - before} message(s) stored while suspended`,
      );
      check(
        'and is told who to ask, rather than just being refused',
        messages.some((m) => /administrator|admin|contact/i.test(m)),
        messages.join(' | ').slice(0, 140),
      );
      check('and it leaks nothing', messages.every(clean), messages.join(' | ').slice(0, 120));

      await context.close();
      await admin.from('profiles').update({ suspended: false }).eq('id', userId);
    }

    console.log('\nA model that no longer exists\n');
    {
      /**
       * A conversation pointing at a model the provider does not have. This is
       * reachable in real use: a model disabled or deleted in the admin panel
       * while someone has the conversation open.
       */
      const { data: anyModel } = await admin
        .from('models')
        .select('provider_id')
        .eq('enabled', true)
        .limit(1)
        .maybeSingle();

      if (!anyModel) {
        console.log('  skip  no enabled model to borrow a provider from.');
      } else {
        const { data: bogus } = await admin
          .from('models')
          .insert({
            provider_id: anyModel.provider_id,
            model_id: 'model-that-does-not-exist',
            display_name: 'Broken press (failure test)',
            max_tokens: 256,
            enabled: true,
          })
          .select('id')
          .single();

        const { data: convo } = await admin
          .from('conversations')
          .insert({ user_id: userId, title: 'Broken model', model_id: bogus!.id })
          .select('id')
          .single();

        const { context, page } = await newPage(true);
        try {
          await page.goto(`${BASE_URL}/c/${convo!.id}`, { waitUntil: 'networkidle' });
          await page.fill('textarea', 'Say hello');
          await page.click('[data-press="quill"]');

          const messages = await waitForMessage(page, 45_000);
          await page.screenshot({ path: `${OUT}/broken-model.png` });

          check('a failing provider tells the user', messages.length > 0, 'the page said nothing');
          check(
            'and the vendor payload does not reach the screen',
            messages.every(clean),
            messages.join(' | ').slice(0, 140),
          );

          // The composer must come back, or the user is stuck on one failure.
          const composerUsable = await page.evaluate(
            `!document.querySelector('textarea').disabled`,
          );
          check('and the composer is usable again afterwards', composerUsable === true);
        } finally {
          await context.close();
          await admin.from('conversations').delete().eq('id', convo!.id);
          await admin.from('models').delete().eq('id', bogus!.id);
        }
      }
    }
  } finally {
    await browser.close();
    // Restored unconditionally: a suite that leaves the budget at 1 token
    // breaks every suite after it.
    await restoreSetting(budgetBefore);
    await restoreSetting(rateBefore);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\nSettings restored, test user cleaned up.');
  }

  console.log(
    failures === 0
      ? '\nEvery failure path says something true and useful.'
      : `\n${failures} failure-path check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-failures crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
