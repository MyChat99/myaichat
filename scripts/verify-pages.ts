/**
 * Every page, at every width, looked at rather than assumed.
 *
 * The suites in this repo assert rows, bytes and source text. None of them
 * opens a page and asks whether it is usable — which is how three visual
 * defects shipped past a thousand passing assertions. This one renders every
 * route as a real admin user at 360px, 768px and 1440px and fails on the
 * defects a screenshot would show you:
 *
 *   - the page overflows sideways, so content is unreachable on a phone
 *   - a console error, which means something on the page is broken
 *   - a tap target smaller than the 24px WCAG 2.2 minimum
 *   - an image with no alt text, or a control with no accessible name
 *   - the heading order skips a level, which breaks screen-reader navigation
 *   - nothing is focusable, or the focused element has no visible ring
 *
 * Screenshots of every page at every width land in docs/screenshots/pages/.
 *
 *   npm run dev
 *   npm run verify:pages
 */
import { mkdirSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';

import type { Database } from '../lib/db/types';
import { THEMES } from '../lib/theme/presets';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = 'docs/screenshots/pages';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'pages-test-password-1234';

const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** The three widths that matter: a small phone, a tablet, a laptop. */
const WIDTHS = [
  { name: '360', width: 360, height: 780 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
];

let failures = 0;
const problems: string[] = [];

function check(name: string, passed: boolean, detail = '') {
  if (passed) console.log(`  ok    ${name}`);
  else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    problems.push(`${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

type Audit = {
  overflowBy: number;
  clipped: string[];
  smallTargets: string[];
  namelessControls: string[];
  imagesWithoutAlt: number;
  headingJumps: string[];
};

/**
 * Everything measured in one pass in the page, because a second evaluate can
 * land after a re-render and describe a different page than the first.
 *
 * Written as a source string rather than a closure: tsx compiles with esbuild's
 * `keepNames`, which rewrites every named function into a `__name(...)` call —
 * a helper that exists in this process and not in the browser. A closure passed
 * to `evaluate` therefore arrives referencing an undefined symbol and throws
 * `__name is not defined` on every page. A string is shipped verbatim.
 */
const AUDIT_SCRIPT = `(() => {
  const doc = document.documentElement;

  /**
   * Sideways overflow, measured where this app can actually have it.
   *
   * The document-level test (\`scrollWidth > clientWidth\` on <html>) is useless
   * here and was proven so: a deliberately 2200px-wide element inside the shell
   * left the document at exactly 360px, because the shell clips with
   * \`overflow: hidden\`. Nothing scrolls — the content is simply gone, which is
   * worse than a scrollbar and invisible to the obvious check.
   *
   * So both are measured: the document for pages outside the shell (login,
   * signup), and every clipping container for pages inside it.
   *
   * \`overflow-x: auto|scroll\` is not a defect — the user can reach the content.
   * Truncation with an ellipsis is not either; that is a deliberate one-line
   * label, and it makes \`scrollWidth > clientWidth\` true by design.
   */
  let overflowBy = Math.max(0, doc.scrollWidth - doc.clientWidth);

  const clipped = [];
  Array.from(document.querySelectorAll('*')).forEach(function (el) {
    const style = getComputedStyle(el);
    if (style.overflowX !== 'hidden' && style.overflowX !== 'clip') return;
    if (style.textOverflow === 'ellipsis') return;
    if (style.whiteSpace === 'nowrap') return;
    const by = el.scrollWidth - el.clientWidth;
    if (by > 8) {
      clipped.push(el.tagName.toLowerCase() + (el.getAttribute('data-press') ? '[' + el.getAttribute('data-press') + ']' : '') + ' clips ' + by + 'px');
      if (by > overflowBy) overflowBy = by;
    }
  });

  const describe = function (el) {
    const tag = el.tagName.toLowerCase();
    const press = el.getAttribute('data-press');
    const text = (el.textContent || '').trim().slice(0, 24);
    return tag + (press ? '[' + press + ']' : '') + (text ? ' "' + text + '"' : '');
  };

  const visible = function (el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };

  // Elements removed from the accessibility tree are excluded: an
  // \`aria-hidden\` input with \`tabindex="-1"\` is the hidden field Radix renders
  // beside a switch so it submits with a form. It is not a control, no screen
  // reader sees it, and requiring it to have a name only teaches you to ignore
  // this check.
  const exposed = function (el) {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    return el.tabIndex >= 0;
  };

  const controls = Array.from(
    document.querySelectorAll('a[href], button, [role="switch"], input, select, textarea'),
  ).filter(function (el) { return visible(el) && exposed(el); });

  // WCAG 2.2 target size (minimum) is 24x24 CSS px, measured on what is
  // actually tappable — which is not always the element's own box.
  //
  // A control may push its hit area outwards with an absolutely-positioned
  // pseudo-element on negative insets; the switch component does exactly that,
  // so an 18px switch is really a 34px target and reporting it would be wrong.
  const effectiveBox = function (el) {
    const box = el.getBoundingClientRect();
    let width = box.width;
    let height = box.height;
    for (const pseudo of ['::after', '::before']) {
      const style = getComputedStyle(el, pseudo);
      if (style.content === 'none' || style.position !== 'absolute') continue;
      const inset = function (side) {
        const value = parseFloat(style[side]);
        return Number.isNaN(value) ? 0 : Math.max(0, -value);
      };
      width += inset('left') + inset('right');
      height += inset('top') + inset('bottom');
    }
    return { width, height };
  };

  // The spec exempts a target "in a sentence or block of text", and padding
  // such a link to 24px would wreck the line height of the paragraph it sits
  // in.
  //
  // The test is the criterion itself, not a length threshold: the element is
  // laid out \`inline\` — so it flows within a line rather than occupying its own
  // box — and there is other text beside it in its parent. A first attempt used
  // "parent is at least 12 characters longer", which called "No account?
  // Create one" a standalone control by one character.
  const inlineInProse = function (el) {
    if (el.tagName !== 'A') return false;
    if (getComputedStyle(el).display !== 'inline') return false;
    const parent = el.parentElement;
    if (!parent) return false;
    const own = (el.textContent || '').trim();
    const all = (parent.textContent || '').trim();
    return all.length > own.length && all.replace(own, '').trim().length > 0;
  };

  const smallTargets = controls
    .filter(function (el) {
      if (inlineInProse(el)) return false;
      const box = effectiveBox(el);
      return box.width < 24 || box.height < 24;
    })
    .map(function (el) {
      const box = effectiveBox(el);
      return describe(el) + ' ' + Math.round(box.width) + 'x' + Math.round(box.height);
    });

  const accessibleName = function (el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return true;
    if (el.getAttribute('aria-labelledby')) return true;
    if ((el.textContent || '').trim()) return true;
    if (el.querySelector('img[alt]:not([alt=""])')) return true;
    if (el.querySelector('svg title, [aria-label]')) return true;
    const id = el.getAttribute('id');
    if (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) return true;
    if (el.closest('label')) return true;
    const title = el.getAttribute('title');
    if (title && title.trim()) return true;
    // A placeholder is not a name, but a hidden input needs none.
    return el.getAttribute('type') === 'hidden';
  };

  const namelessControls = controls.filter(function (el) { return !accessibleName(el); }).map(describe);

  const imagesWithoutAlt = Array.from(document.querySelectorAll('img')).filter(function (img) {
    return visible(img) && img.getAttribute('alt') === null;
  }).length;

  const levels = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter(visible)
    .map(function (h) {
      return { level: Number(h.tagName[1]), text: (h.textContent || '').trim().slice(0, 30) };
    });

  const headingJumps = [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i].level - levels[i - 1].level > 1) {
      headingJumps.push('h' + levels[i - 1].level + ' -> h' + levels[i].level + ' at "' + levels[i].text + '"');
    }
  }

  return { overflowBy, clipped, smallTargets, namelessControls, imagesWithoutAlt, headingJumps };
})()`;

async function auditPage(page: Page): Promise<Audit> {
  return page.evaluate(AUDIT_SCRIPT) as Promise<Audit>;
}

/**
 * Contrast as it is actually painted, which is not the same question as
 * contrast between two tokens.
 *
 * `verify:theme` proves every pair in a palette definition meets AA. That says
 * nothing about whether the CSS pairs the *right* two: the selected
 * conversation card was painted in `--overprint` and reversed out in
 * `--primary-foreground`, two colours which had each passed against their own
 * partner and which came to **1.43:1** against each other at night. The one
 * thing on the page you are looking at was very nearly invisible, and no
 * token-level check could have seen it.
 *
 * So this walks the rendered page, takes the computed colour of every element
 * with its own text, resolves the first opaque background behind it, and
 * applies WCAG 1.4.3 — 4.5:1, or 3:1 for large text.
 */
const CONTRAST_SCRIPT = `(() => {
  const relative = function (channel) {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = function (rgb) {
    return 0.2126 * relative(rgb[0]) + 0.7152 * relative(rgb[1]) + 0.0722 * relative(rgb[2]);
  };
  /**
   * Resolved by painting it, not by parsing it.
   *
   * \`getComputedStyle().color\` returns \`oklch(...)\` for anything built with
   * \`color-mix()\`, and a regex that grabs the first three numbers reads
   * \`oklch(0.83 0.115 350)\` as RGB(0.83, 0.115, 350). That is not a small
   * error — it invented a 2.85:1 failure for a token measuring 5.97:1, and I
   * nearly changed the syntax colours on the strength of it. Canvas
   * \`fillStyle\` alone is not enough either: it declines to normalise an
   * out-of-sRGB value to hex. Painting one pixel and reading it back always
   * yields sRGB bytes.
   */
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const paint = canvas.getContext('2d', { willReadFrequently: true });
  const parse = function (value) {
    if (!value) return null;
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = '#000000';
    paint.fillStyle = value;
    paint.fillRect(0, 0, 1, 1);
    const data = paint.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2]];
  };
  const ratio = function (a, b) {
    const x = luminance(a);
    const y = luminance(b);
    const hi = Math.max(x, y);
    const lo = Math.min(x, y);
    return (hi + 0.05) / (lo + 0.05);
  };

  /**
   * The first ancestor that actually paints. A background with alpha below
   * ~0.85 lets the layer beneath through, so it is not what the text sits on.
   */
  const backdrop = function (el) {
    let node = el;
    while (node) {
      const value = getComputedStyle(node).backgroundColor;
      const parts = (value || '').match(/[\\d.]+/g);
      if (parts && (parts.length < 4 || Number(parts[3]) > 0.85)) return value;
      node = node.parentElement;
    }
    return null;
  };

  const findings = [];
  Array.from(document.querySelectorAll('body *')).forEach(function (el) {
    // Only elements holding their own text. A wrapper inherits a colour it
    // never paints anything with.
    const own = Array.from(el.childNodes)
      .filter(function (n) { return n.nodeType === 3 && n.textContent.trim(); })
      .map(function (n) { return n.textContent.trim(); })
      .join(' ');
    if (!own) return;

    /**
     * A lettermark standing in for a vendor's logo is exempt: WCAG 1.4.3 does
     * not apply to text that is part of a logo or brand name, these are
     * \`aria-hidden\`, and the provider's name is in real text beside them.
     * Exempted by what they are, so the exemption cannot quietly widen.
     */
    if (el.closest('[aria-hidden="true"]')) return;

    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return;
    if (Number(style.opacity) < 0.5) return;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    const fg = parse(style.color);
    const bg = parse(backdrop(el));
    if (!fg || !bg) return;

    const px = parseFloat(style.fontSize);
    const large = px >= 24 || (px >= 18.66 && Number(style.fontWeight) >= 700);
    const minimum = large ? 3 : 4.5;
    const measured = ratio(fg, bg);

    if (measured < minimum - 0.01) {
      findings.push(
        measured.toFixed(2) + ':1 (needs ' + minimum + ') ' +
        el.tagName.toLowerCase() +
        (el.getAttribute('data-press') ? '[' + el.getAttribute('data-press') + ']' : '') +
        ' "' + own.slice(0, 28) + '" at ' + style.fontSize,
      );
    }
  });
  return findings;
})()`;

/** Records how every focusable element looks BEFORE anything has focus. */
const FOCUS_BASELINE = `(() => {
  window.__focusBaseline = new Map();
  window.__snap = function (el) {
    const s = getComputedStyle(el);
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor,
            s.backgroundColor, s.color, s.textDecorationLine].join('|');
  };
  document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').forEach(function (el) {
    window.__focusBaseline.set(el, window.__snap(el));
  });
  return true;
})()`;

/** Describes whatever currently has focus, and whether it looks any different. */
const FOCUS_READ = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const seen = el.hasAttribute('data-focus-walked');
  el.setAttribute('data-focus-walked', '');
  const before = window.__focusBaseline.get(el);
  return {
    seen: seen,
    tag: el.tagName.toLowerCase(),
    press: el.getAttribute('data-press'),
    id: el.id || '',
    label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 22),
    changed: before === undefined ? null : before !== window.__snap(el),
    disabled: el.disabled === true,
  };
})()`;

/** One page per shape of page. Focus styling does not vary by route content. */
const FOCUS_ROUTES = [
  { name: 'chat', path: '/c/:id' },
  { name: 'compare', path: '/compare' },
  { name: 'settings', path: '/settings' },
  { name: 'profile', path: '/profile' },
  { name: 'admin', path: '/admin' },
  { name: 'admin-models', path: '/admin/models' },
  { name: 'admin-users', path: '/admin/users' },
  { name: 'admin-providers', path: '/admin/providers' },
  { name: 'login', path: '/login', anonymous: true },
  { name: 'signup', path: '/signup', anonymous: true },
];

async function main() {
  mkdirSync(OUT, { recursive: true });

  const email = `pages-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;
  await admin.from('profiles').update({ role: 'admin' }).eq('id', userId);

  const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  const cookieValue = `base64-${Buffer.from(JSON.stringify(signIn!.session)).toString('base64')}`;

  // A conversation with real content, so /c/[id] is not audited empty.
  const { data: model } = await admin
    .from('models')
    .select('id')
    .eq('enabled', true)
    .limit(1)
    .maybeSingle();
  const { data: convo } = await admin
    .from('conversations')
    .insert({ user_id: userId, title: 'Audit thread', model_id: model?.id ?? null })
    .select('id')
    .single();
  await admin.from('messages').insert([
    { conversation_id: convo!.id, role: 'user', content: 'What is a monotype?' },
    {
      conversation_id: convo!.id,
      role: 'assistant',
      /**
       * The code sample exercises a keyword, a string, a number, a comment and
       * a function name on purpose. An earlier fixture had only `const one = 1`
       * — so the contrast check ran, passed, and had never once looked at a
       * string literal or a comment.
       */
      content:
        '## A monotype\n\nA single impression.\n\n```js\n// how many impressions\nconst count = 1;\nfunction pull(name) {\n  return `one ${name}`;\n}\n```',
    },
  ]);

  const routes = [
    { path: '/', name: 'chat-empty' },
    { path: `/c/${convo!.id}`, name: 'chat-thread' },
    { path: '/compare', name: 'compare' },
    { path: '/profile', name: 'profile' },
    { path: '/settings', name: 'settings' },
    { path: '/admin', name: 'admin' },
    { path: '/admin/analytics', name: 'admin-analytics' },
    { path: '/admin/audit', name: 'admin-audit' },
    { path: '/admin/models', name: 'admin-models' },
    { path: '/admin/providers', name: 'admin-providers' },
    { path: '/admin/settings', name: 'admin-settings' },
    { path: '/admin/users', name: 'admin-users' },
    { path: `/admin/users/${userId}`, name: 'admin-user-detail' },
    { path: '/this-route-does-not-exist', name: 'not-found' },
    /**
     * The two pages a visitor sees before anything else, audited signed OUT.
     * They live outside the app shell, so nothing above covers them — and a
     * broken login page is the only defect that costs you every user at once.
     */
    { path: '/login', name: 'login', anonymous: true },
    { path: '/signup', name: 'signup', anonymous: true },
  ];

  const browser = await chromium.launch();

  try {
    for (const viewport of WIDTHS) {
      console.log(`\n${viewport.width}px\n`);

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: 'reduce',
      });
      await context.addCookies([
        {
          name: `sb-${projectRef}-auth-token`,
          value: cookieValue,
          domain: new URL(BASE_URL).hostname,
          path: '/',
        },
      ]);

      // The signed-out pages need a context with no session, or the app
      // redirects them straight to the chat and they are never audited.
      const anonContext = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: 'reduce',
      });

      for (const route of routes) {
        const page = await (route.anonymous ? anonContext : context).newPage();
        const consoleErrors: string[] = [];
        page.on('console', (message) => {
          if (message.type() !== 'error') return;
          const text = message.text();
          /**
           * The 404 route legitimately answers 404, and the browser logs its own
           * document load as a failed resource. Suppressing it for that one
           * route keeps the check meaningful everywhere else rather than
           * training us to expect a red line here.
           */
          if (route.name === 'not-found' && /status of 404/.test(text)) return;
          consoleErrors.push(text.slice(0, 140));
        });
        page.on('pageerror', (err) => consoleErrors.push(`uncaught: ${err.message.slice(0, 140)}`));

        try {
          await page.goto(`${BASE_URL}${route.path}`, {
            waitUntil: 'networkidle',
            timeout: 45_000,
          });
          await page.waitForTimeout(500);
          await page.screenshot({
            path: `${OUT}/${route.name}-${viewport.name}.png`,
            fullPage: true,
          });

          const audit = await auditPage(page);
          const label = `${route.name} @${viewport.name}`;

          check(
            `${label}: nothing is pushed off the side`,
            audit.overflowBy === 0,
            audit.clipped.length > 0
              ? audit.clipped.slice(0, 4).join(' · ')
              : `${audit.overflowBy}px wider than the viewport`,
          );
          check(`${label}: no console errors`, consoleErrors.length === 0, consoleErrors[0]);
          check(
            `${label}: every control has an accessible name`,
            audit.namelessControls.length === 0,
            audit.namelessControls.slice(0, 3).join(' · '),
          );
          check(
            `${label}: every image declares alt`,
            audit.imagesWithoutAlt === 0,
            `${audit.imagesWithoutAlt} without`,
          );
          check(
            `${label}: heading levels do not skip`,
            audit.headingJumps.length === 0,
            audit.headingJumps.slice(0, 2).join(' · '),
          );
          check(
            `${label}: tap targets are at least 24px`,
            audit.smallTargets.length === 0,
            audit.smallTargets.slice(0, 3).join(' · '),
          );
        } catch (err) {
          check(
            `${route.name} @${viewport.name}: renders`,
            false,
            err instanceof Error ? err.message.slice(0, 100) : String(err),
          );
        } finally {
          await page.close();
        }
      }

      await context.close();
      await anonContext.close();
    }

    /**
     * Contrast, at one width but in BOTH schemes. Contrast does not vary with
     * viewport width; it varies enormously between light and dark, and dark is
     * where the one real failure lived.
     */
    console.log('\nContrast, as painted\n');

    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: scheme,
        reducedMotion: 'reduce',
      });
      await context.addCookies([
        {
          name: `sb-${projectRef}-auth-token`,
          value: cookieValue,
          domain: new URL(BASE_URL).hostname,
          path: '/',
        },
      ]);
      const anonContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: scheme,
      });

      for (const route of routes) {
        const page = await (route.anonymous ? anonContext : context).newPage();
        try {
          await page.goto(`${BASE_URL}${route.path}`, {
            waitUntil: 'networkidle',
            timeout: 45_000,
          });
          await page.waitForTimeout(400);
          const findings = (await page.evaluate(CONTRAST_SCRIPT)) as string[];
          check(
            `${route.name} @${scheme}: every piece of text meets AA`,
            findings.length === 0,
            findings.slice(0, 3).join(' · '),
          );
        } finally {
          await page.close();
        }
      }

      await context.close();
      await anonContext.close();
    }

    /**
     * And then every palette, on the page with the most colour on it.
     *
     * The default palette passing says nothing about the other six. The defect
     * this pass was written for — a card painted in one ink and lettered in
     * another belonging to a different pair — is a *pairing* mistake in CSS,
     * and it shows up only in whichever palette happens to put those two
     * colours far apart. It was invisible in light and 1.43:1 in dark; another
     * palette could hide the same shape of bug somewhere else.
     */
    console.log('\nContrast, every palette\n');

    const { data: preferenceRow } = await admin
      .from('user_preferences')
      .select('preset_theme, theme, accent_color')
      .eq('user_id', userId)
      .maybeSingle();

    try {
      for (const theme of THEMES) {
        for (const mode of ['light', 'dark'] as const) {
          await admin.from('user_preferences').upsert(
            {
              user_id: userId,
              preset_theme: theme.id,
              theme: mode,
              accent_color: 'theme',
            },
            { onConflict: 'user_id' },
          );

          const context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            colorScheme: mode,
            reducedMotion: 'reduce',
          });
          await context.addCookies([
            {
              name: `sb-${projectRef}-auth-token`,
              value: cookieValue,
              domain: new URL(BASE_URL).hostname,
              path: '/',
            },
          ]);
          const page = await context.newPage();
          try {
            await page.goto(`${BASE_URL}/c/${convo!.id}`, {
              waitUntil: 'networkidle',
              timeout: 45_000,
            });
            await page.waitForTimeout(350);
            const findings = (await page.evaluate(CONTRAST_SCRIPT)) as string[];
            check(
              `${theme.label}/${mode}: every piece of text meets AA`,
              findings.length === 0,
              findings.slice(0, 3).join(' · '),
            );
          } finally {
            await page.close();
            await context.close();
          }
        }
      }
    } finally {
      // Restored even on failure — the next suite in the chain reads this row.
      if (preferenceRow) {
        await admin.from('user_preferences').update(preferenceRow).eq('user_id', userId);
      }
    }

    /**
     * Keyboard reachability, checked once — it does not vary by width.
     *
     * Tabbing from the top of the chat page must reach the composer without
     * passing through anything that takes focus and shows nothing.
     */
    console.log('\nKeyboard\n');

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        domain: new URL(BASE_URL).hostname,
        path: '/',
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });

    const trail: string[] = [];
    let reachedComposer = false;
    let invisibleFocus: string | null = null;

    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      const focused = (await page.evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          press: el.getAttribute('data-press'),
          visible: box.width > 0 && box.height > 0 && style.visibility !== 'hidden',
        };
      })()`)) as { tag: string; press: string | null; visible: boolean } | null;
      if (!focused) continue;
      trail.push(focused.press ?? focused.tag);
      if (!focused.visible && !invisibleFocus) {
        invisibleFocus = `${focused.tag}${focused.press ? `[${focused.press}]` : ''}`;
      }
      if (focused.tag === 'textarea') {
        reachedComposer = true;
        break;
      }
    }

    check(
      'tabbing from the top reaches the composer',
      reachedComposer,
      trail.join(' → ').slice(0, 160),
    );
    check(
      'and no invisible element steals focus on the way',
      invisibleFocus === null,
      invisibleFocus ?? '',
    );

    await context.close();

    /**
     * WCAG 2.4.7, on every stop rather than on the one control I thought of.
     *
     * This used to check the send button and nothing else. The rule applies to
     * every focusable element, and a keyboard user who cannot see where they
     * are is stuck on whichever control was missed.
     *
     * Tabbed for real, not focused programmatically: `:focus-visible` — which
     * is what the styles key off — does not match an element focused by script
     * with no prior keyboard interaction, so `el.focus()` reports every button
     * in the app as having no indicator.
     */
    console.log('\nFocus is visible on every stop\n');

    for (const route of FOCUS_ROUTES) {
      const walkContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      });
      if (!route.anonymous) {
        await walkContext.addCookies([
          {
            name: `sb-${projectRef}-auth-token`,
            value: cookieValue,
            domain: new URL(BASE_URL).hostname,
            path: '/',
          },
        ]);
      }
      const walkPage = await walkContext.newPage();

      try {
        const path = route.path === '/c/:id' ? `/c/${convo!.id}` : route.path;
        await walkPage.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });
        await walkPage.waitForTimeout(400);
        await walkPage.evaluate(FOCUS_BASELINE);

        const invisible: string[] = [];
        let stops = 0;

        for (let i = 0; i < 80; i++) {
          await walkPage.keyboard.press('Tab');
          const stop = (await walkPage.evaluate(FOCUS_READ)) as {
            seen: boolean;
            tag: string;
            press: string | null;
            id: string;
            label: string;
            changed: boolean | null;
            disabled: boolean;
          } | null;
          if (!stop) continue;
          // Revisits are detected on the DOM node itself. Keying on a label
          // ended the walk after one stop on the sign-in page, where every
          // input has empty text — it reported 1 stop where there are 5, and
          // truncated the admin walk from 46 stops to 22.
          if (stop.seen) break;
          stops++;
          if (stop.changed === false && !stop.disabled) {
            invisible.push(
              `${stop.tag}${stop.press ? `[${stop.press}]` : stop.id ? `#${stop.id}` : ''} "${stop.label}"`,
            );
          }
        }

        check(
          `${route.name}: all ${stops} tab stops show focus`,
          stops > 0 && invisible.length === 0,
          stops === 0 ? 'nothing was focusable' : invisible.slice(0, 4).join(' · '),
        );
      } finally {
        await walkPage.close();
        await walkContext.close();
      }
    }
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\nTest user cleaned up.');
  }

  if (failures > 0) {
    console.error(`\n${failures} page check(s) FAILED:\n`);
    for (const problem of problems) console.error(`  · ${problem}`);
  } else {
    console.log('\nEvery page renders clean at 360, 768 and 1440.');
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-pages crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
