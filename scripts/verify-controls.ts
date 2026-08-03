/**
 * Two controls that are only controls if you can actually operate them.
 *
 * Both of these shipped as things that LOOKED interactive and were not — the
 * composer's model chip was a `<span>` carrying the model name for months, and
 * the portrait was an image. That failure mode is invisible to a rendering test
 * (the markup is there, it has the right text, it is in the right place) and to
 * a type-check. The only thing that catches it is driving the control.
 *
 * ⚠️ Run against a PRODUCTION build, not `next dev`:
 *
 *   npm run build && PORT=3100 npm run start
 *   npm run verify:controls -- --base=http://localhost:3100
 *
 * `next dev` cannot reproduce the server/client boundary class that took
 * production down, and both of these touch that boundary — the chip is a client
 * control rendered inside a server-rendered shell, and the portrait deliberately
 * imports `attachmentUrl` from a directive-free module.
 */
import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';

import type { Database } from '../lib/db/types';
import { buildPng } from './_fixtures';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';
import { PRESET_COUNT, presetIndexFor, presetRef } from '../lib/upload/urls';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const BASE = arg('base', process.env.BASE_URL ?? 'http://localhost:3000');
const OUT = arg('out', 'docs/screenshots/controls');
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'controls-plate-folio-2610';
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

/** What the browser reports about an element, or null when it is absent. */
async function describe(page: Page, selector: string) {
  return (await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    return {
      tag: el.tagName,
      expanded: el.getAttribute('aria-expanded'),
      haspopup: el.getAttribute('aria-haspopup'),
      label: el.getAttribute('aria-label') || '',
      text: (el.textContent || '').trim(),
      focusable: el.tabIndex >= 0 || el.tagName === 'BUTTON',
    };
  })()`)) as {
    tag: string;
    expanded: string | null;
    haspopup: string | null;
    label: string;
    text: string;
    focusable: boolean;
  } | null;
}

async function main() {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(OUT, { recursive: true });

  const email = `controls-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  const browser = await chromium.launch();

  try {
    console.log(`Interactive controls — ${BASE}\n`);

    // Two enabled models from DIFFERENT rows, so "switching" means something.
    const { data: models } = await admin
      .from('models')
      .select('id, model_id, display_name, providers!inner(enabled, key_last4)')
      .eq('enabled', true)
      .eq('providers.enabled', true)
      .not('providers.key_last4', 'is', null)
      .limit(2);

    if ((models ?? []).length < 2) {
      console.error('Needs two enabled models on keyed providers.');
      process.exit(1);
    }
    const [first, second] = models!;

    const { data: convo } = await admin
      .from('conversations')
      .insert({ user_id: userId, title: 'Controls', model_id: first.id })
      .select('id')
      .single();

    // A real avatar: the expander is inert without one, by design.
    const png = buildPng(64);
    const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const cookieValue = `base64-${Buffer.from(JSON.stringify(signIn!.session)).toString('base64')}`;
    const cookieHeader = `sb-${projectRef}-auth-token=${cookieValue}`;

    const presign = await fetch(`${BASE}/api/uploads/presign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({
        filename: 'portrait.png',
        mimeType: 'image/png',
        sizeBytes: png.length,
        scope: 'avatar',
      }),
    });
    const presigned = (await presign.json().catch(() => null)) as {
      uploadUrl?: string;
      key?: string;
    } | null;
    if (presigned?.uploadUrl) {
      const put = await fetch(presigned.uploadUrl, { method: 'PUT', body: new Uint8Array(png) });
      if (put.ok) {
        await admin.from('profiles').update({ avatar_url: presigned.key }).eq('id', userId);
      }
    }
    const { data: profile } = await admin
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .single();
    check('the test account has a real avatar to enlarge', Boolean(profile?.avatar_url));

    const name = `sb-${projectRef}-auth-token`;
    const domain = new URL(BASE).hostname;
    const cookies =
      cookieValue.length <= CHUNK
        ? [{ name, value: cookieValue, domain, path: '/' }]
        : Array.from({ length: Math.ceil(cookieValue.length / CHUNK) }, (_, n) => ({
            name: `${name}.${n}`,
            value: cookieValue.slice(n * CHUNK, (n + 1) * CHUNK),
            domain,
            path: '/',
          }));

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(cookies);
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    await page.goto(`${BASE}/c/${convo!.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // ── A1: the composer model chip ───────────────────────────────────────
    console.log('\nThe composer model chip\n');

    const CHIP = '[data-press="setting"][data-interactive="true"]';
    const chip = await describe(page, CHIP);

    check('the chip exists', chip !== null);
    check(
      'and it is a BUTTON, not a label',
      chip?.tag === 'BUTTON',
      `<${(chip?.tag ?? 'absent').toLowerCase()}>`,
    );
    check('and it is keyboard-focusable', chip?.focusable === true);
    check(
      'and it announces itself as opening a listbox',
      chip?.haspopup === 'listbox' && chip?.expanded === 'false',
      `haspopup=${chip?.haspopup} expanded=${chip?.expanded}`,
    );
    check(
      'and it names the current model for a screen reader',
      /model/i.test(chip?.label ?? ''),
      chip?.label,
    );
    check(
      'and it shows the model that is actually selected',
      (chip?.text ?? '').toLowerCase().includes(first.display_name.toLowerCase()),
      `chip says "${chip?.text}", conversation is on "${first.display_name}"`,
    );

    await page.screenshot({ path: `${OUT}/1-chip-closed.png` });

    await page.click(CHIP);
    await page.waitForTimeout(400);
    check(
      'clicking it opens a listbox',
      (await page.locator('[role="listbox"]').count()) > 0 &&
        (await describe(page, CHIP))?.expanded === 'true',
    );
    check(
      'and the listbox offers every enabled model',
      (await page.locator('[role="option"]').count()) >= 2,
      `${await page.locator('[role="option"]').count()} option(s)`,
    );
    await page.screenshot({ path: `${OUT}/2-chip-open.png` });

    // Escape must close it, same as the header control.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('Escape closes it', (await page.locator('[role="listbox"]').count()) === 0);

    /**
     * The behaviour that matters: selecting here must persist the same way
     * selecting in the header does. Asserted against the STORED row, not
     * against the chip's own text — a chip that updates its label while the
     * conversation keeps the old model is exactly the bug worth catching.
     */
    await page.click(CHIP);
    await page.waitForTimeout(300);
    await page.click(`[role="option"]:has-text("${second.display_name}")`);
    await page.waitForTimeout(2500);

    const { data: after } = await admin
      .from('conversations')
      .select('model_id')
      .eq('id', convo!.id)
      .single();

    check(
      'selecting a model mid-conversation PERSISTS it',
      after?.model_id === second.id,
      `stored ${after?.model_id === first.id ? 'the old model' : String(after?.model_id)}`,
    );
    check(
      'and the chip now shows the new model',
      ((await describe(page, CHIP))?.text ?? '')
        .toLowerCase()
        .includes(second.display_name.toLowerCase()),
      (await describe(page, CHIP))?.text,
    );

    // ── A2: the portrait ──────────────────────────────────────────────────
    /**
     * Driven on BOTH page types, because the portrait renders TWICE.
     *
     * `app/(app)/layout.tsx` puts one in the masthead, `section-tabs.tsx` puts
     * one in the tab rail, and `body:has([data-press='tabs'])` hides the
     * masthead wherever the tabs render. So on a chat page — the screen a
     * reader actually spends their time on — the visible portrait is the tabs
     * one and the masthead copy sits in the DOM, hidden.
     *
     * That is a trap for this exact test, and it caught me. `.first()` matches
     * the HIDDEN masthead copy, which has perfect ARIA and cannot be clicked.
     * The first version of this file "fixed" the resulting timeout by moving to
     * /profile and concluding the control was not on the chat screen. It was —
     * the other copy was, and it was still inert, because only the masthead had
     * been converted. A passing test would have shipped a dead avatar on the
     * page it matters on.
     *
     * `:visible` is therefore load-bearing, and both pages are exercised.
     */
    const TRIGGER = '[data-press="portrait-trigger"]:visible';

    for (const [where, path] of [
      ['chat page (tab rail)', `/c/${convo!.id}`],
      ['/profile (masthead)', '/profile'],
    ] as const) {
      console.log(`\nThe portrait — ${where}\n`);

      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);

      const visible = await page.locator(TRIGGER).count();
      check(`exactly one VISIBLE portrait here`, visible === 1, `${visible} visible trigger(s)`);

      const trigger = await describe(page, '[data-press="portrait-trigger"]');
      check('it is a button', trigger?.tag === 'BUTTON', trigger?.tag ?? 'absent');
      check(
        'and announces itself as opening a dialog',
        trigger?.haspopup === 'dialog' && trigger?.expanded === 'false',
        `haspopup=${trigger?.haspopup} expanded=${trigger?.expanded}`,
      );
      check(
        'and has a label naming what it does',
        /larger/i.test(trigger?.label ?? ''),
        trigger?.label,
      );

      await page.locator(TRIGGER).click();
      await page.waitForTimeout(450);
      check(
        'clicking it enlarges the portrait',
        (await page.locator('[role="dialog"]').count()) > 0,
      );
      check(
        'and the enlarged image really DECODED',
        ((await page.evaluate(
          `(() => { const i = document.querySelector('[data-press="portrait-large"] img'); return i ? i.naturalWidth : 0; })()`,
        )) as number) > 0,
      );
      check(
        'and focus moved into it',
        (await page.evaluate(
          `document.activeElement?.getAttribute('data-press') === 'portrait-large'`,
        )) === true,
      );
      await page.screenshot({
        path: `${OUT}/3-portrait-${path === '/profile' ? 'profile' : 'chat'}.png`,
      });

      await page.keyboard.press('Escape');
      await page.waitForTimeout(450);
      check('Escape closes it', (await page.locator('[role="dialog"]').count()) === 0);
      check(
        'and focus returns to the trigger, not to the body',
        (await page.evaluate(
          `document.activeElement?.getAttribute('data-press') === 'portrait-trigger'`,
        )) === true,
      );

      // "Clicking anywhere else returns it to the small form."
      await page.locator(TRIGGER).click();
      await page.waitForTimeout(450);
      await page.mouse.click(30, 640);
      await page.waitForTimeout(450);
      check(
        'clicking elsewhere on the page closes it',
        (await page.locator('[role="dialog"]').count()) === 0,
      );
    }

    // ── A2b: the three portrait states, in BOTH places ────────────────────
    /**
     * Uploaded photo, chosen mark, and nothing chosen — each asserted in the
     * masthead AND the tab rail.
     *
     * The states are exclusive by construction (one column), so the risk is not
     * that both render — it is that one LOCATION handles a state the other does
     * not. That has already happened once here, and a test that checked a single
     * location would not have seen it.
     *
     * "Nothing chosen" asserts the SPECIFIC mark the id hashes to, not merely
     * that a mark appeared. Everyone getting mark 0 is the plausible failure,
     * and it looks identical to working unless the index is checked.
     */
    console.log('\nPortrait states, in both locations\n');

    /**
     * Distinctiveness, tested INDEPENDENTLY of the app.
     *
     * The per-location checks below compare what rendered against
     * `presetIndexFor(userId)` — which is a consistency check between the app
     * and the function, and cannot detect the function being wrong. Replacing
     * its body with `return 0` left every one of those checks green, because
     * the expectation and the reality moved together. A test that imports the
     * thing it is testing to compute its own expectation is a tautology.
     *
     * So the spread is asserted over many ids at once. "Everyone is distinctive
     * in the same way" is the plausible failure for a feature like this, it
     * looks identical to working, and only this shape of check sees it.
     */
    const spread = new Set(
      Array.from({ length: 240 }, (_, i) =>
        presetIndexFor(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
      ),
    );
    check(
      'the marks are actually spread across the set, not all one',
      spread.size >= PRESET_COUNT - 1,
      `${spread.size} of ${PRESET_COUNT} marks used across 240 ids`,
    );

    const seeded = presetIndexFor(userId);

    const LOCATIONS = [
      ['tab rail', `/c/${convo!.id}`],
      ['masthead', '/profile'],
    ] as const;

    for (const [state, stored, expect] of [
      ['an uploaded photo', profile?.avatar_url ?? null, 'img'],
      ['a chosen mark', presetRef(5), 'mark:5'],
      ['nothing chosen', null, `mark:${seeded}`],
    ] as const) {
      await admin.from('profiles').update({ avatar_url: stored }).eq('id', userId);

      for (const [where, path] of LOCATIONS) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        const seen = (await page.evaluate(`(() => {
          const frames = Array.from(document.querySelectorAll('[data-press="portrait"]'))
            .filter((f) => f.getBoundingClientRect().width > 0);
          const frame = frames[0];
          if (!frame) return 'none';
          const img = frame.querySelector('img');
          if (img) return img.naturalWidth > 0 ? 'img' : 'img-broken';
          const svg = frame.querySelector('svg[data-mark]');
          return svg ? 'mark:' + svg.getAttribute('data-mark') : 'empty';
        })()`)) as string;

        check(
          `${where}: ${state} renders correctly`,
          seen === expect,
          `expected ${expect}, saw ${seen}`,
        );
      }
    }

    // Leave the account as the walk found it, so the console-error check below
    // is not reading a state this block invented.
    await admin
      .from('profiles')
      .update({ avatar_url: profile?.avatar_url ?? null })
      .eq('id', userId);
    await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    check(
      'no console errors while operating either control',
      consoleErrors.length === 0,
      consoleErrors[0]?.slice(0, 160),
    );

    await context.close();
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\nTest user cleaned up.');
  }

  console.log(
    failures === 0
      ? `\nBoth controls are operable. Screenshots in ${OUT}/`
      : `\n${failures} control check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-controls crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
