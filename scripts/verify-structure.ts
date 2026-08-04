/**
 * Proves the layout is the layout, whatever the palette.
 *
 * The app used to have two designs: a print treatment for one theme and a
 * generic one for the rest, so choosing Rose did not change the colours of a
 * newspaper — it swapped the newspaper for something else. The structure is now
 * permanent and a theme supplies colour and nothing else.
 *
 * "And nothing else" is the part worth checking, in two ways:
 *
 *  1. STATICALLY — app/press.css may not name a theme or a colour. A selector
 *     scoped to `[data-theme=…]`, or a hex literal, is how the two drift apart
 *     again, and both are visible in the source.
 *
 *  2. IN A BROWSER — load every palette in both modes and compare the computed
 *     border widths, radii, shadows, fonts and spacing of the real elements.
 *     Source discipline does not prove rendered sameness; measurement does.
 *
 *   npm run verify:structure          # needs a dev server
 */
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { readFile, readdir } from 'node:fs/promises';

import { chromium, type Page } from 'playwright';

import type { Database } from '../lib/db/types';
import { THEMES } from '../lib/theme/presets';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const BASE = arg('base', process.env.BASE_URL ?? 'http://localhost:3000');
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'structure-test-password-1234';
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
 * The properties a palette must NOT touch, sampled from elements the design is
 * actually made of. Colour is deliberately absent: it is the one thing that is
 * allowed to differ.
 */
const PROBE = `(() => {
  var sel = [
    ['sidebar',   'aside'],
    ['masthead',  '[data-press="masthead"]'],
    ['wordmark',  '[data-press="wordmark"]'],
    ['action',    '[data-press="draft"]'],
    ['divider',   '[data-press="divider"]'],
    ['card',      '[data-press="slip"]'],
    ['stamp',     '[data-press="stamp"]'],
    ['rule',      '[data-press="rule"]'],
    ['folio',     '[data-press="folio"]'],
    ['pill',      '[data-press="ticket"]'],
    ['tab',       '[data-press="tab"]'],
    ['headline',  '[data-press="headline"]'],
    ['pick',      '[data-press="pick"]'],
    ['picknum',   '[data-press="pick-n"]'],
    ['compose',   '[data-press="coupon"]'],
    ['composelbl','[data-press="coupon-l"]'],
    ['submit',    '[data-press="quill"]']
  ];
  var out = {};
  for (var i = 0; i < sel.length; i++) {
    var el = document.querySelector(sel[i][1]);
    if (!el) { out[sel[i][0]] = 'MISSING'; continue; }
    var c = getComputedStyle(el);
    out[sel[i][0]] = [
      c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth,
      c.borderTopStyle, c.borderTopLeftRadius, c.borderBottomRightRadius,
      c.fontFamily, c.fontSize, c.fontWeight, c.letterSpacing, c.textTransform,
      c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft,
      c.display, c.gap,
      // The offset shadow, with the colour stripped — a solid 4px offset is
      // structure; which ink it is printed in is not.
      c.boxShadow.replace(/rgba?\\([^)]*\\)/g, 'INK')
    ].join('|');
  }
  return JSON.stringify(out);
})()`;

async function shape(page: Page): Promise<Record<string, string>> {
  return JSON.parse((await page.evaluate(PROBE)) as string) as Record<string, string>;
}

async function main() {
  console.log('Source discipline\n');

  const css = readFileSync(new URL('../app/press.css', import.meta.url), 'utf8');
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  check('press.css names no theme', !/\[data-theme[=\]]/.test(withoutComments));
  const literals = [...withoutComments.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
    .map((m) => m[0])
    // The paper-grain SVG is a data URI, not a colour choice.
    .filter((hex) => !withoutComments.includes(`%23${hex.slice(1)}`));
  check('press.css names no colour', literals.length === 0, literals.slice(0, 5).join(', '));
  check('press.css draws its rules in the ink role', withoutComments.includes('var(--border)'));

  /**
   * Every SVG in the repo must be well-formed XML.
   *
   * `app/icon.svg` shipped broken because a comment in it named a CSS custom
   * property directly — and XML forbids two hyphens in a row inside a comment,
   * so the leading `--` of the token ended it early and the parser aborted.
   *
   * The failure is silent from every angle this project usually looks from:
   * the route returned 200, the content-type was `image/svg+xml`, the file was
   * the right size, and the markup read correctly to a human. It simply did not
   * render, in any browser. Only opening it directly, or parsing it, says so.
   *
   * Parsed rather than pattern-matched: a regex for `--` inside comments finds
   * the bug we already had, and this finds the next one too.
   */
  console.log('\nEvery SVG is well-formed XML\n');
  const svgFiles = [
    ...(await readdir('app')).filter((f) => f.endsWith('.svg')).map((f) => `app/${f}`),
    ...(await readdir('public')).filter((f) => f.endsWith('.svg')).map((f) => `public/${f}`),
  ];
  for (const file of svgFiles) {
    const body = await readFile(file, 'utf8');
    /*
     * The exact rule that shipped a broken icon: XML forbids two hyphens in a
     * row inside a comment, and the note in `app/icon.svg` named a CSS custom
     * property directly, so the token's leading `--` ended the comment early
     * and the parser aborted.
     *
     * Silent from every angle this project usually checks: the route returned
     * 200, the content-type was right, the size was right, and the markup read
     * correctly to a human. It simply did not render, in any browser.
     */
    const badComment = (body.match(/<!--[\s\S]*?-->/g) ?? []).some((c) =>
      c.slice(4, -3).includes('--'),
    );
    check(`${file}: no double hyphen inside a comment`, !badComment, 'XML forbids "--" there');
  }

  console.log('\nRendered structure, every palette, both modes\n');

  const email = `structure-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  try {
    await admin.from('profiles').update({ role: 'admin' }).eq('id', userId);
    const { data: models } = await admin.from('models').select('id').eq('enabled', true).limit(1);
    for (const [i, title] of [
      'Which model are you?',
      'Rate limiting the chat endpoint',
    ].entries()) {
      await admin.from('conversations').insert({
        user_id: userId,
        title,
        model_id: models?.[0]?.id ?? null,
        created_at: new Date(Date.now() - i * 3600_000).toISOString(),
        updated_at: new Date(Date.now() - i * 3600_000).toISOString(),
      });
    }

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
    const shapes: { label: string; shape: Record<string, string> }[] = [];

    for (const theme of THEMES) {
      for (const mode of ['light', 'dark'] as const) {
        await admin
          .from('user_preferences')
          .update({ preset_theme: theme.id, theme: mode, accent_color: 'theme' })
          .eq('user_id', userId);

        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          colorScheme: mode,
          reducedMotion: 'reduce',
        });
        await context.addCookies(cookies);
        const page = await context.newPage();
        await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(250);
        shapes.push({ label: `${theme.label}/${mode}`, shape: await shape(page) });
        await context.close();
      }
    }
    await browser.close();

    const reference = shapes[0];
    const missing = Object.entries(reference.shape)
      .filter(([, v]) => v === 'MISSING')
      .map(([k]) => k);
    check('every structural element renders', missing.length === 0, missing.join(', '));

    for (const other of shapes.slice(1)) {
      const differing = Object.keys(reference.shape).filter(
        (key) => reference.shape[key] !== other.shape[key],
      );
      check(
        `${other.label} is structurally identical to ${reference.label}`,
        differing.length === 0,
        differing.length ? `differs at: ${differing.join(', ')}` : '',
      );
    }
  } finally {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(
    failures === 0
      ? `\nOne layout, ${THEMES.length} palettes, ${THEMES.length * 2} renders. All identical.`
      : `\n${failures} structure check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-structure crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
