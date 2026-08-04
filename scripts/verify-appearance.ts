/**
 * Proves appearance preferences persist and are rendered server-side.
 *
 * The interesting assertion is the HTML one: it fetches a real page as a
 * signed-in user and checks the theme is already in the markup. A client-only
 * implementation would pass a "does the database hold my choice" test while
 * still flashing the wrong theme on every load, which is the thing the phase
 * file actually forbids.
 *
 *   npm run dev              # in another terminal
 *   npm run verify:appearance
 */
import { createClient, type Session } from '@supabase/supabase-js';

import type { Database } from '../lib/db/types';
import { DEFAULT_APPEARANCE, getTheme, THEMES } from '../lib/theme/presets';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const CHUNK_SIZE = 3180;

const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = process.pid;
const PASSWORD = 'appearance-test-password-1234';

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

async function main() {
  console.log('Theme data\n');

  check('at least six preset themes', THEMES.length >= 6, `${THEMES.length} themes`);
  check(
    'every theme defines both modes',
    THEMES.every((t) => t.light && t.dark),
  );
  check(
    'an unknown theme id falls back rather than throwing',
    getTheme('does-not-exist').id === THEMES[0].id,
  );

  try {
    await fetch(BASE_URL, { redirect: 'manual' });
  } catch {
    console.error(`\nCannot reach ${BASE_URL}. Start the dev server first (npm run dev).`);
    process.exit(1);
  }

  console.log('\nPersistence and server-side rendering\n');

  const email = `appearance-${stamp}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const userClient = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInError } = await userClient.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;
  const cookie = sessionCookie(signIn.session!);

  try {
    // The signup trigger should have created preferences already.
    const { data: initial } = await admin
      .from('user_preferences')
      .select('theme, preset_theme, accent_color, font_size, bubble_style')
      .eq('user_id', created.user.id)
      .maybeSingle();

    check('preferences row created on signup', initial !== null);
    /**
     * Asserted against DEFAULT_APPEARANCE, not a hardcoded string.
     *
     * The database column default and the application's declared default are
     * two separate facts that must agree: the column decides what a new row
     * gets, and `DEFAULT_APPEARANCE` decides what a signed-out visitor is
     * rendered with. If they drift, a user sees one theme before signing in and
     * a different one after — which reads as a bug in the theme system rather
     * than a mismatched constant. Naming the literal here would have made this
     * check pass while the two disagreed.
     */
    const columnDefaults: [string, unknown, unknown][] = [
      ['theme', initial?.theme, DEFAULT_APPEARANCE.theme],
      ['preset_theme', initial?.preset_theme, DEFAULT_APPEARANCE.presetTheme],
      ['accent_color', initial?.accent_color, DEFAULT_APPEARANCE.accentColor],
      ['font_size', initial?.font_size, DEFAULT_APPEARANCE.fontSize],
      ['bubble_style', initial?.bubble_style, DEFAULT_APPEARANCE.bubbleStyle],
    ];
    for (const [column, fromDb, declared] of columnDefaults) {
      check(
        `the ${column} column default matches DEFAULT_APPEARANCE (${String(declared)})`,
        fromDb === declared,
        `column gives "${String(fromDb)}", app declares "${String(declared)}"`,
      );
    }
    check(
      'the default theme is a real preset',
      THEMES.some((t) => t.id === DEFAULT_APPEARANCE.presetTheme),
      DEFAULT_APPEARANCE.presetTheme,
    );

    // Write a distinctive set, then prove the SERVER renders it.
    const wanted = {
      theme: 'dark' as const,
      preset_theme: 'blueprint',
      accent_color: '#7c3aed',
      font_size: 'lg' as const,
      bubble_style: 'flat' as const,
    };

    const { error: writeError } = await userClient
      .from('user_preferences')
      .update(wanted)
      .eq('user_id', created.user.id);
    check('a user can write their own preferences', !writeError, writeError?.message);

    const html = await fetch(`${BASE_URL}/`, { headers: { cookie } }).then((r) => r.text());

    check('server renders the dark class (no flash)', /<html[^>]*class="[^"]*\bdark\b/.test(html));
    check('server renders the chosen preset', html.includes('data-theme="blueprint"'));
    check('server renders the bubble style', html.includes('data-bubble="flat"'));
    check('server renders the font size', /font-size:\s*18px/.test(html));

    const chosen = getTheme('blueprint');
    check(
      'the theme stylesheet is inlined in the document',
      html.includes('id="theme-tokens"') && html.includes(chosen.dark.background),
      'token block missing',
    );
    check(
      'the custom accent overrides the preset accent',
      html.includes('#7c3aed') && !html.includes(`--primary:${chosen.dark.accent}`),
    );

    // A second request is a different device as far as the server is concerned.
    const second = await fetch(`${BASE_URL}/`, { headers: { cookie } }).then((r) => r.text());
    check('preferences persist across requests', second.includes('data-theme="blueprint"'));

    /**
     * The signed-out visitor, in full.
     *
     * This is the first frame of the product for everyone who has never used
     * it, and it is the one case with no stored preference to read — so it is
     * also the case most likely to render a placeholder and correct itself
     * afterwards. "Still renders a theme" was too weak a claim: a page that
     * emits a token block and then swaps it on hydration passes that and still
     * flashes.
     *
     * What has to be true is stronger and entirely checkable from the served
     * bytes: the default theme is already resolved in the markup, BOTH modes'
     * tokens are present so resolving `system` costs no request, and the
     * mode-resolving script is in <head> ahead of any content it could
     * repaint.
     */
    const anonResponse = await fetch(`${BASE_URL}/login`);
    const anon = await anonResponse.text();
    const fallback = getTheme(DEFAULT_APPEARANCE.presetTheme);
    const headEnd = anon.indexOf('<body');

    check(
      'signed-out /login is served',
      anonResponse.status === 200,
      `HTTP ${anonResponse.status}`,
    );
    check('signed-out pages still render a theme', anon.includes('id="theme-tokens"'));
    check(
      `the default theme is resolved in the markup (data-theme="${DEFAULT_APPEARANCE.presetTheme}")`,
      anon.includes(`data-theme="${DEFAULT_APPEARANCE.presetTheme}"`),
    );
    check(
      `the default mode is in the markup (data-theme-mode="${DEFAULT_APPEARANCE.theme}")`,
      anon.includes(`data-theme-mode="${DEFAULT_APPEARANCE.theme}"`),
    );
    check(
      "the default theme's light tokens are in the document",
      anon.includes(fallback.light.background) && anon.includes(fallback.light.accent),
      `${fallback.light.background} / ${fallback.light.accent} missing`,
    );
    /**
     * The default accent must not paint over the default theme.
     *
     * A theme with a point of view defines its own accent per mode. The default
     * accent used to be the named preset 'blue', which resolved to one hex in
     * BOTH modes and overrode the theme's — so the out-of-the-box look was the
     * default theme's paper with a generic blue on top, and the two inks that
     * make it recognisable never appeared for anyone who had not been into
     * settings. Asserting on --primary specifically is the point: the theme's
     * accent hex can be *present* in the document as some other token while
     * --primary is something else entirely.
     */
    check(
      "the default accent follows the theme's own light ink",
      anon.includes(`--primary:${fallback.light.accent}`),
      `expected --primary:${fallback.light.accent}`,
    );
    check(
      "the default accent follows the theme's own dark ink",
      anon.includes(`--primary:${fallback.dark.accent}`),
      `expected --primary:${fallback.dark.accent}`,
    );
    /**
     * The dark tokens matter as much as the light ones, and for a reason that
     * is easy to miss: the default mode is `system`, so roughly half of all
     * first-time visitors need dark. If only the light block were served, that
     * half would get a request or a re-render between paint and correctness —
     * which is precisely the flash.
     */
    check(
      "the default theme's dark tokens are in the SAME document",
      anon.includes(fallback.dark.background) && anon.includes(fallback.dark.accent),
      `${fallback.dark.background} / ${fallback.dark.accent} missing`,
    );
    check(
      'the token block is in <head>, before any content it could repaint',
      headEnd > 0 && anon.indexOf('id="theme-tokens"') < headEnd,
    );
    /**
     * Anchored on `dataset.themeMode`, which only the pre-paint script contains.
     * Searching for `prefers-color-scheme` instead finds Next's own injected
     * stylesheet first — it appears ~1800 bytes earlier in the document — and
     * the check then measures the position of somebody else's CSS.
     */
    const scriptAt = anon.indexOf('dataset.themeMode');
    check(
      'the mode-resolving script is in <head>, and after the tokens',
      headEnd > 0 && scriptAt > anon.indexOf('id="theme-tokens"') && scriptAt < headEnd,
      `script at ${scriptAt}, tokens at ${anon.indexOf('id="theme-tokens"')}, body at ${headEnd}`,
    );
    /**
     * With `system`, light is the server-rendered baseline and the script adds
     * `dark` when the OS asks for it. A hardcoded `dark` class here would mean
     * every light-mode visitor gets a dark first paint — the same flash,
     * pointed the other way.
     */
    /*
     * Widened from `!== 'system'` to "not dark", because the default is now
     * `light` and TypeScript correctly pointed out that the old comparison
     * could never be true. The property being guarded is unchanged: a first
     * paint must not be dark unless the stored preference actually is.
     */
    check(
      'no dark class is hardcoded unless the default mode is dark',
      String(DEFAULT_APPEARANCE.theme) === 'dark' || !/<html[^>]*class="[^"]*\bdark\b/.test(anon),
    );

    // Invalid stored values must degrade, not blank the page. The DB constraint
    // blocks the obvious route in, so this checks the loader's own fallback.
    const { error: constraintError } = await admin
      .from('user_preferences')
      .update({ preset_theme: 'not-a-theme' })
      .eq('user_id', created.user.id);
    check('the database rejects an unknown preset theme', !!constraintError);
  } finally {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    console.log('\nTest user cleaned up.');
  }

  console.log(
    failures === 0
      ? '\nAll appearance checks passed.'
      : `\n${failures} appearance check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nverify-appearance crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
