/**
 * Proves the chosen theme survives navigation.
 *
 * Logs in through the real form, sets a theme, then moves around the app by
 * CLICKING LINKS — not `page.goto`. That distinction is the whole point: a
 * `goto` is a full document load, which re-runs the root layout and would
 * repaint the theme correctly even if client-side navigation loses it. The
 * reported bug only exists on client-side navigation, so the test has to
 * navigate the way a user does.
 *
 * At every step it records what the page is ACTUALLY painted with — the
 * attribute, the dark class, and the computed background and primary colours —
 * and fails if any step differs from the one before it.
 *
 *   npm run verify:persistence
 *   npm run verify:persistence -- --base=https://…    # against production
 */
import { mkdirSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';

import type { Database } from '../lib/db/types';
import { SECRET_KEY, SUPABASE_URL } from './_env';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const BASE = arg('base', process.env.BASE_URL ?? 'http://localhost:3000');
const OUT = arg('out', 'docs/screenshots/persistence');
const PASSWORD = 'persistence-test-password-1234';

const admin = createClient<Database>(SUPABASE_URL(), SECRET_KEY(), {
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

/** What the browser is painting, read from computed style — not from React. */
type Painted = {
  dataTheme: string;
  mode: string;
  dark: boolean;
  background: string;
  primary: string;
  /** Whether Riso's own furniture is present, i.e. the SERVER agreed. */
  masthead: boolean;
};

async function painted(page: Page): Promise<Painted> {
  return (await page.evaluate(`(() => {
    var root = document.documentElement;
    var cs = getComputedStyle(root);
    return {
      dataTheme: root.getAttribute('data-theme') || '',
      mode: root.getAttribute('data-theme-mode') || '',
      dark: root.classList.contains('dark'),
      background: cs.getPropertyValue('--background').trim(),
      primary: cs.getPropertyValue('--primary').trim(),
      masthead: !!document.querySelector('[data-riso="masthead"]'),
    };
  })()`)) as Painted;
}

function describe(p: Painted): string {
  return `theme=${p.dataTheme} mode=${p.mode} dark=${p.dark} bg=${p.background} primary=${p.primary} masthead=${p.masthead}`;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const email = `persist-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  try {
    // Promote to admin so the Admin tab exists to navigate to, and start from a
    // theme that is NOT the one we are about to choose — otherwise "it stayed
    // Riso" could just mean "it was never anything else".
    await admin.from('profiles').update({ role: 'admin' }).eq('id', userId);
    await admin
      .from('user_preferences')
      .update({ preset_theme: 'default', theme: 'dark', accent_color: 'blue' })
      .eq('user_id', userId);

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark', // the OS says dark; choosing Light must beat it
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();

    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => problems.push(e.message.slice(0, 300)));

    const steps: { label: string; state: Painted }[] = [];
    const record = async (label: string) => {
      await page.waitForTimeout(500);
      const state = await painted(page);
      steps.push({ label, state });
      await page.screenshot({ path: `${OUT}/${steps.length}-${label}.png` });
      console.log(`  ${String(steps.length).padStart(2)}. ${label.padEnd(22)} ${describe(state)}`);
      return state;
    };

    console.log('\nWalking the app\n');

    // ── log in, for real ───────────────────────────────────────────────────
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
    await record('after-login');

    // ── choose Riso + Light and save ───────────────────────────────────────
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Light' }).click();
    await page.waitForTimeout(600);
    await page.locator('button[aria-pressed]', { hasText: 'Riso' }).first().click();
    // No save button to press — selecting is choosing. If that stops being
    // true, this step fails and so does everything after it.
    await page.waitForTimeout(1500);
    await record('after-selecting');

    // ── now navigate the way a user does: by clicking ──────────────────────
    //
    // Settings has no rule bar, so it has no section tabs — the way back to the
    // chat from there is the wordmark. Worth noticing in its own right.
    const clickLink = async (name: string) => {
      const link = page.getByRole('link', { name, exact: true }).first();
      await link.waitFor({ state: 'visible', timeout: 15_000 });
      await link.click();
      await page.waitForLoadState('networkidle');
    };

    await clickLink('myaichat');
    await record('chat-via-click');

    await clickLink('Admin');
    await record('admin-via-click');

    // Also the wordmark: outside the chat there are no section tabs, so `Page`
    // does not exist to click. See the note on navigation below.
    await clickLink('myaichat');
    await record('back-to-chat');

    // A full reload should agree with everything above.
    await page.reload({ waitUntil: 'networkidle' });
    await record('after-hard-reload');

    // ── the path that was actually reported ────────────────────────────────
    //
    // The exact reported path: choose a theme, leave at once. This used to
    // discard the choice, because the picker previewed without committing.
    console.log('\nSelecting a theme and navigating away immediately\n');

    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    await page.locator('button[aria-pressed]', { hasText: 'Ocean' }).first().click();
    await page.waitForTimeout(400);
    const previewed = await painted(page);
    console.log(`      while still on settings   ${describe(previewed)}`);
    await page.screenshot({ path: `${OUT}/7-unsaved-preview.png` });

    await clickLink('myaichat');
    await page.waitForTimeout(500);
    const afterLeaving = await painted(page);
    console.log(`      after navigating away     ${describe(afterLeaving)}`);
    await page.screenshot({ path: `${OUT}/8-unsaved-after-navigation.png` });

    check(
      'a theme selected and immediately navigated away from is kept',
      afterLeaving.dataTheme === previewed.dataTheme,
      `chose ${previewed.dataTheme}, ended on ${afterLeaving.dataTheme}`,
    );

    // ── how long does a click take? ────────────────────────────────────────
    console.log('\nNavigation timing (client-side, cold cache per click)\n');
    const timings: { to: string; ms: number }[] = [];
    for (const [name, label] of [
      ['Admin', 'admin'],
      ['myaichat', 'chat'],
      ['Appearance', 'settings'],
      ['myaichat', 'chat'],
    ] as const) {
      const started = Date.now();
      await clickLink(name);
      timings.push({ to: label, ms: Date.now() - started });
    }
    for (const t of timings) console.log(`      → ${t.to.padEnd(10)} ${t.ms} ms`);
    const slowest = Math.max(...timings.map((t) => t.ms));

    console.log('\nDoes the theme hold?\n');

    const first = steps[1].state; // the moment of selection is the reference
    for (const step of steps.slice(2)) {
      const same =
        step.state.dataTheme === first.dataTheme &&
        step.state.dark === first.dark &&
        step.state.background === first.background &&
        step.state.primary === first.primary;
      check(`${step.label} matches the saved theme`, same, describe(step.state));
    }

    check('selecting Riso applied Riso', first.dataTheme === 'riso', first.dataTheme);
    check('choosing Light beat the OS dark preference', first.dark === false, describe(first));
    check(
      'the server rendered Riso structure too, not just colour',
      steps.slice(2).every((s) => s.state.masthead),
      'the masthead is missing on at least one step',
    );
    check('no navigation took longer than 2s', slowest < 2000, `slowest ${slowest}ms`);

    if (problems.length) {
      console.error('\n  console errors:');
      for (const p of [...new Set(problems)]) console.error(`    ${p}`);
      failures++;
    }

    await browser.close();
  } finally {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(
    failures === 0
      ? `\nTheme persists across navigation. Screenshots in ${OUT}/`
      : `\n${failures} persistence check(s) FAILED. Screenshots in ${OUT}/`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-persistence crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
