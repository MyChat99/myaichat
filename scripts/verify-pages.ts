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

  // The spec exempts a target "in a sentence or block of text". A link whose
  // parent holds prose around it is that case, and padding it to 24px would
  // wreck the line height of the paragraph it sits in.
  const inlineInProse = function (el) {
    if (el.tagName !== 'A') return false;
    const parent = el.parentElement;
    if (!parent) return false;
    const own = (el.textContent || '').trim().length;
    return (parent.textContent || '').trim().length > own + 12;
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
      content: '## A monotype\n\nA single impression.\n\n```js\nconst one = 1;\n```',
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

      for (const route of routes) {
        const page = await context.newPage();
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

    // A visible focus ring on the send button, which is the control a keyboard
    // user most needs to find.
    await page.focus('[data-press="quill"]');
    const ring = (await page.evaluate(`(() => {
      const el = document.querySelector('[data-press="quill"]');
      if (!el) return null;
      const style = getComputedStyle(el);
      return { outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
    })()`)) as { outlineWidth: string; boxShadow: string } | null;
    check(
      'the focused send button shows a ring',
      Boolean(ring && (parseFloat(ring.outlineWidth) > 0 || ring.boxShadow !== 'none')),
      JSON.stringify(ring),
    );

    await context.close();
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
