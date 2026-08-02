/**
 * Screenshots the running app so its appearance can actually be looked at.
 *
 * This exists because three visual defects — duplicated labels, a shell that
 * scrolled its own header away, and a hydration mismatch — shipped past 1,085
 * assertions. Every suite in this repo checks bytes, database rows or source
 * text. None of them renders a page, so none of them can see what the app looks
 * like, and neither could I.
 *
 * It signs in a throwaway user, gives it a little history so the sidebar is not
 * empty, forces a theme and colour scheme, and writes PNGs to docs/screenshots/
 * — deleting the user afterwards.
 *
 *   npm run shoot                      # riso, light, default routes
 *   npm run shoot -- --theme=default   # prove another preset is untouched
 *   npm run shoot -- --scheme=dark
 *   npm run shoot -- --base=http://localhost:3100
 *
 * Reduced motion is emulated by default: the entrance animations otherwise
 * make every screenshot a race with the shutter.
 */
import { mkdirSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';

import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const BASE = arg('base', process.env.BASE_URL ?? 'http://localhost:3000');
const THEME = arg('theme', 'riso');
const SCHEME = arg('scheme', 'light') as 'light' | 'dark';
const OUT = arg('out', 'docs/screenshots');
/**
 * 1x by default. Riso's paper grain is per-pixel noise, which does not
 * compress — a 2x shot of it is 1.8MB against 450KB, and these are committed so
 * the look can be reviewed without running anything.
 */
const SCALE = Number(arg('scale', '1'));

const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'shoot-harness-password-1234';
const CHUNK = 3180;

/** A sidebar with one row tells you nothing about how a sidebar looks. */
const HISTORY = [
  'Which model are you?',
  'Rate limiting the chat endpoint',
  'Closures, with a worked example',
  'Row-level security policy review',
  'Presigned uploads and the CORS surprise',
  'Keeping secrets out of logs',
];

const REPLY = `I'm Claude Haiku 4.5, reached through this app's Anthropic adapter.

The honest answer is that I could not tell you unaided. A model is finished before it is deployed, so its own version is generally not in its training data — which is why models elsewhere answer this confidently and wrongly.

\`\`\`ts
const system = \`You are \${model.displayName}.\`;
\`\`\`

What makes it reliable here is plain: the application writes the selected model's name into the system prompt on every request.`;

async function main() {
  mkdirSync(OUT, { recursive: true });

  const email = `shoot-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  try {
    const { data: models } = await admin.from('models').select('id').eq('enabled', true).limit(1);
    const modelId = models?.[0]?.id ?? null;

    let threadId: string | null = null;
    for (const [i, title] of HISTORY.entries()) {
      const at = new Date(Date.now() - i * 5 * 3600_000).toISOString();
      const { data: conversation } = await admin
        .from('conversations')
        .insert({ user_id: userId, title, model_id: modelId, created_at: at, updated_at: at })
        .select('id')
        .single();
      if (!conversation) continue;
      if (i === 0) {
        threadId = conversation.id;
        await admin.from('messages').insert([
          {
            conversation_id: conversation.id,
            role: 'user',
            content: 'Which model are you, and how do you know?',
          },
          { conversation_id: conversation.id, role: 'assistant', content: REPLY },
        ]);
      }
    }

    await admin
      .from('user_preferences')
      .update({ preset_theme: THEME, theme: 'system' })
      .eq('user_id', userId);

    const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    if (signInError) throw signInError;

    const value = `base64-${Buffer.from(JSON.stringify(signIn.session)).toString('base64')}`;
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
      deviceScaleFactor: SCALE,
      colorScheme: SCHEME,
      // Otherwise every shot is a race against the entrance animations.
      reducedMotion: 'reduce',
    });
    await context.addCookies(cookies);
    const page = await context.newPage();

    // A console error is a defect even when the pixels look fine — the
    // hydration mismatch that shipped was only ever visible here.
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text().slice(0, 2500));
    });
    page.on('pageerror', (e) => problems.push(e.message.slice(0, 200)));

    const shots: [string, string][] = [
      ['empty-state', '/'],
      ['settings', '/settings'],
    ];
    if (threadId) shots.push(['conversation', `/c/${threadId}`]);

    const tag = `${THEME}-${SCHEME}`;
    for (const [label, path] of shots) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const file = `${OUT}/${tag}-${label}.png`;
      await page.screenshot({ path: file });
      console.log(`  ${file}`);
    }

    // The sidebar on its own, because it is where most of the theme lives and
    // it is 20% of a full-page shot.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const aside = page.locator('aside').first();
    if (await aside.isVisible()) {
      const file = `${OUT}/${tag}-sidebar.png`;
      await aside.screenshot({ path: file });
      console.log(`  ${file}`);
    }

    let failed = await reportDuplication(page);
    failed = (await reportThemeLeak(page)) || failed;
    failed = (await reportNavigationReachable(page)) || failed;

    if (problems.length) {
      console.error('\n  console errors:');
      for (const p of [...new Set(problems)]) console.error(`    ${p}`);
      failed = true;
    } else {
      console.log('\n  no console errors');
    }

    await browser.close();
    if (failed) process.exitCode = 1;
  } finally {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

/**
 * Catches the specific failure this script was written for.
 *
 * Theme-specific copy is rendered for one theme and hidden for the others. If
 * the stylesheet that hides it does not apply, BOTH variants render and the
 * page reads "New chat Start a page" — which is not a styling problem that a
 * screenshot makes obvious at a glance, but is trivially detectable in text.
 */
/**
 * Navigation must survive a theme attribute that the server did not render.
 *
 * `data-theme` lives in the DOM and the appearance panel's live preview writes
 * to it directly, so it can say `riso` while the server-rendered markup was
 * built with riso=false. Riso hides the shell's navigation bar and expects the
 * rule bar to carry the replacement — so when those two disagree, the header is
 * hidden and nothing replaces it, and the user loses Profile, Appearance, Admin
 * and Sign out with no way back.
 *
 * This forces exactly that state and asserts navigation is still reachable.
 */
async function reportNavigationReachable(page: Page): Promise<boolean> {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  // Simulate a previewed-but-not-server-rendered theme.
  //
  // Evaluated as source text rather than a function: tsx compiles arrow
  // functions with esbuild's `__name` helper, which does not exist in the page
  // and throws there.
  await page.evaluate(`document.documentElement.dataset.theme = 'riso'`);
  await page.waitForTimeout(200);

  const reachable = (await page.evaluate(`(() => {
    var els = Array.prototype.slice.call(
      document.querySelectorAll('a[href], button[type="submit"]'),
    );
    var visible = els.filter(function (el) { return el.offsetParent !== null; });
    function has(text) {
      return visible.some(function (el) {
        return (el.textContent || '').trim().toLowerCase().indexOf(text) !== -1;
      });
    }
    return { appearance: has('appearance'), profile: has('profile'), signOut: has('sign out') };
  })()`)) as Record<string, boolean>;

  const missing = Object.entries(reachable)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  if (missing.length) {
    console.error(
      `\n  NAVIGATION LOST when data-theme is out of step with the server: ${missing.join(', ')}`,
    );
    return true;
  }
  console.log('  navigation survives a mismatched data-theme');
  return false;
}

async function reportDuplication(page: Page): Promise<boolean> {
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const pairs: [string, string][] = [
    ['New chat', 'Start a page'],
    ['How can I help?', 'A quiet place'],
    ['Pick a prompt', 'nothing here is precious'],
  ];
  const both = pairs.filter(([a, b]) => text.includes(a) && text.includes(b));
  if (both.length) {
    console.error('\n  BOTH VARIANTS RENDERED — the theme stylesheet is not applying:');
    for (const [a, b] of both) console.error(`    "${a}" and "${b}"`);
    return true;
  }
  console.log('  no duplicated theme copy');
  return false;
}

/**
 * Riso's extra furniture must not appear on any other theme.
 *
 * These elements are gated on a `riso` prop rather than hidden with CSS, so a
 * miswired conditional renders them unstyled into a theme that has no design
 * for them — which is exactly what happened to the sidebar's stamp line: it
 * shipped into the default theme at full body size, and no assertion in the
 * repo could see it.
 */
async function reportThemeLeak(page: Page): Promise<boolean> {
  // The structure is permanent now — see verify:structure, which asserts every
  // palette renders it identically. Nothing is theme-only to leak.
  return false;
  // eslint-disable-next-line no-unreachable

  const RISO_ONLY = [
    'masthead',
    'wordmark',
    'issue',
    'stamp',
    'divider',
    'lede-num',
    'pick-n',
    'coupon-l',
    'colophon',
    'folio',
  ];
  const leaked: string[] = [];
  for (const hook of RISO_ONLY) {
    if ((await page.locator(`[data-riso="${hook}"]`).count()) > 0) leaked.push(hook);
  }

  if (leaked.length) {
    console.error(`\n  RISO-ONLY MARKUP LEAKED INTO "${THEME}": ${leaked.join(', ')}`);
    return true;
  }
  console.log(`  no riso-only markup in "${THEME}"`);
  return false;
}

main().catch((err: unknown) => {
  console.error('shoot failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
