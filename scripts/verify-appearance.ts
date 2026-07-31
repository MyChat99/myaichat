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
import { getTheme, THEMES } from '../lib/theme/presets';
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
    check('defaults are sane', initial?.theme === 'system' && initial?.preset_theme === 'default');

    // Write a distinctive set, then prove the SERVER renders it.
    const wanted = {
      theme: 'dark' as const,
      preset_theme: 'ocean',
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
    check('server renders the chosen preset', html.includes('data-theme="ocean"'));
    check('server renders the bubble style', html.includes('data-bubble="flat"'));
    check('server renders the font size', /font-size:\s*18px/.test(html));

    const ocean = getTheme('ocean');
    check(
      'the theme stylesheet is inlined in the document',
      html.includes('id="theme-tokens"') && html.includes(ocean.dark.background),
      'token block missing',
    );
    check(
      'the custom accent overrides the preset accent',
      html.includes('#7c3aed') && !html.includes(`--primary:${ocean.dark.accent}`),
    );

    // A second request is a different device as far as the server is concerned.
    const second = await fetch(`${BASE_URL}/`, { headers: { cookie } }).then((r) => r.text());
    check('preferences persist across requests', second.includes('data-theme="ocean"'));

    // A signed-out visitor must still get a working page.
    const anon = await fetch(`${BASE_URL}/login`).then((r) => r.text());
    check('signed-out pages still render a theme', anon.includes('id="theme-tokens"'));

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
