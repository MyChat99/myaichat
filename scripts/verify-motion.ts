/**
 * The motion layer, measured rather than admired.
 *
 * Three things can go wrong with motion and none of them is visible in a
 * screenshot:
 *
 *   1. It does not actually stop for someone who asked it to stop. A global
 *      `transition-duration: 0.01ms` collapses durations but cannot undo an
 *      animation's *starting frame*, so a keyframe with `both` fill that begins
 *      at `opacity: 0` still flashes in. That has already happened once in this
 *      project, to the masthead.
 *   2. It moves the page. Anything animating a property that affects layout is
 *      a layout-shift bug, and the cheapest proof is that every element sits in
 *      exactly the same place with motion on and with motion off.
 *   3. The timings drift. Once durations are written as literals in twelve
 *      rules, "interaction feedback under 200ms" stops being true one rule at a
 *      time.
 *
 *   npm run dev
 *   npm run verify:motion
 */
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';

import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'motion-test-password-1234';

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

/** The only durations any rule is allowed to use. */
const TOKENS = ['--press-quick', '--press-settle', '--press-slide'];

/**
 * Computed timing for everything on the page that declares any.
 * Returns the worst case, because one slow rule is enough to break the promise.
 */
const TIMING_SCRIPT = `(() => {
  const out = [];
  Array.from(document.querySelectorAll('body *')).forEach(function (el) {
    const s = getComputedStyle(el);
    const durations = (s.animationDuration + ',' + s.transitionDuration)
      .split(',')
      .map(function (d) { return d.trim(); })
      .filter(Boolean)
      .map(function (d) { return d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000; })
      .filter(function (n) { return !Number.isNaN(n); });
    const worst = durations.length ? Math.max.apply(null, durations) : 0;
    if (worst > 0) {
      out.push({
        worst: worst,
        name: el.tagName.toLowerCase() + (el.getAttribute('data-press') ? '[' + el.getAttribute('data-press') + ']' : ''),
        animation: s.animationName,
      });
    }
  });
  return out;
})()`;

/** Where every visible element sits, keyed stably enough to compare two renders. */
const GEOMETRY_SCRIPT = `(() => {
  const out = {};
  Array.from(document.querySelectorAll('body *')).forEach(function (el, i) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return;
    const key = i + ':' + el.tagName.toLowerCase() + ':' + (el.getAttribute('data-press') || '');
    out[key] = Math.round(b.x) + ',' + Math.round(b.y) + ',' + Math.round(b.width) + ',' + Math.round(b.height);
  });
  return out;
})()`;

/** Opacity of the things that animate in, so "held at the finished frame" is testable. */
const VISIBILITY_SCRIPT = `(() => {
  const out = [];
  Array.from(document.querySelectorAll('[data-message], [data-press="caret"]')).forEach(function (el) {
    const s = getComputedStyle(el);
    out.push({
      name: el.tagName.toLowerCase() + (el.getAttribute('data-press') ? '[' + el.getAttribute('data-press') + ']' : '[message]'),
      opacity: Number(s.opacity),
      transform: s.transform,
    });
  });
  return out;
})()`;

async function main() {
  console.log('The tokens exist and the rules use them\n');

  const css = readFileSync('app/press.css', 'utf8');

  for (const token of TOKENS) {
    const declared = new RegExp(`${token}:\\s*\\d+ms`).test(css);
    const uses = css.split(`var(${token})`).length - 1;
    check(
      `${token} is declared and used`,
      declared && uses > 0,
      `declared=${declared} uses=${uses}`,
    );
  }

  /**
   * Durations written as literals rather than tokens, inside the motion block.
   * The block is delimited so the older rules above it — which predate the
   * tokens — are not counted; this guards new work, it does not rewrite history.
   */
  // Sliced from the comment that OPENS the block, not from the marker inside
  // it: starting mid-comment leaves an unterminated `/*` that the stripper
  // below cannot match, so the rest of that comment survives and is read as
  // rule text. That is exactly how "0.01ms" — a number in a sentence — was
  // reported as a hardcoded duration.
  const motionStart = css.lastIndexOf('/*', css.indexOf('══ motion ══'));
  const motionBlock = css
    .slice(motionStart)
    // Comments stripped first. The prose in this block explains the timings —
    // "at 190ms and 4px", "Tailwind's default 150ms" — and a check that reads
    // its own documentation as a violation is a check nobody will keep.
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = [...motionBlock.matchAll(/(?<![-\w])(\d+)ms/g)].map((m) => m[0]);
  check(
    'no duration in the motion block is written as a literal',
    literals.length === 0,
    literals.join(', '),
  );

  check(
    'interaction feedback is under 200ms',
    Number(/--press-quick:\s*(\d+)ms/.exec(css)?.[1] ?? 999) < 200,
    /--press-quick:\s*(\d+)ms/.exec(css)?.[1],
  );

  // --- browser -------------------------------------------------------------
  const email = `motion-${process.pid}@example.com`;
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

  const { data: model } = await admin
    .from('models')
    .select('id')
    .eq('enabled', true)
    .limit(1)
    .maybeSingle();
  const { data: convo } = await admin
    .from('conversations')
    .insert({ user_id: userId, title: 'Motion', model_id: model?.id ?? null })
    .select('id')
    .single();
  await admin.from('messages').insert([
    { conversation_id: convo!.id, role: 'user', content: 'Does this move?' },
    { conversation_id: convo!.id, role: 'assistant', content: 'It settles.' },
  ]);

  const browser = await chromium.launch();

  const open = async (motion: 'reduce' | 'no-preference'): Promise<[Page, () => Promise<void>]> => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: motion,
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
    await page.goto(`${BASE_URL}/c/${convo!.id}`, { waitUntil: 'networkidle' });
    // Long enough for every animation above to have finished.
    await page.waitForTimeout(1200);
    return [page, () => context.close()];
  };

  try {
    console.log('\nWith motion\n');
    const [full, closeFull] = await open('no-preference');

    const timings = (await full.evaluate(TIMING_SCRIPT)) as {
      worst: number;
      name: string;
      animation: string;
    }[];
    check(
      'something on the page actually animates',
      timings.length > 0,
      `${timings.length} elements`,
    );

    /**
     * The masthead's registration animation is exempt, by name.
     *
     * It is a one-shot 1.5s brand flourish that runs once on load — a second
     * plate sliding into register — and it is deliberate. The promise this
     * check enforces is about *interaction* feedback, which is a different
     * category from a one-time load animation. Exempted explicitly rather than
     * by raising the ceiling, so the exemption is one named animation and
     * cannot quietly grow to cover a slow button.
     */
    const interactive = timings.filter((t) => t.animation !== 'press-register');
    const slowest = interactive.reduce((a, b) => (a.worst > b.worst ? a : b), {
      worst: 0,
      name: '—',
      animation: '',
    });
    check(
      'no interaction animation runs longer than the slide token',
      slowest.worst <= 240,
      `${slowest.name} at ${slowest.worst}ms (${slowest.animation})`,
    );
    check(
      'and the one exempt animation is still the masthead, not something new',
      timings.filter((t) => t.worst > 240).every((t) => t.animation === 'press-register'),
      timings
        .filter((t) => t.worst > 240 && t.animation !== 'press-register')
        .map((t) => `${t.name}=${t.animation}`)
        .join(', '),
    );

    // The caret carries no radius. The design system's premise is that nothing
    // does, and the markup it replaced had `rounded-sm` on it.
    const caretRadius = (await full.evaluate(`(() => {
      const el = document.createElement('span');
      el.setAttribute('data-press', 'caret');
      document.body.appendChild(el);
      const r = getComputedStyle(el).borderRadius;
      el.remove();
      return r;
    })()`)) as string;
    check(
      'the streaming caret is square, like everything else here',
      caretRadius === '0px',
      caretRadius,
    );

    const geometryFull = (await full.evaluate(GEOMETRY_SCRIPT)) as Record<string, string>;
    const visibleFull = (await full.evaluate(VISIBILITY_SCRIPT)) as {
      name: string;
      opacity: number;
    }[];
    check(
      'every animated element has settled to full opacity',
      visibleFull.every((v) => v.opacity > 0.99),
      visibleFull
        .filter((v) => v.opacity <= 0.99)
        .map((v) => `${v.name}=${v.opacity}`)
        .join(', '),
    );
    await closeFull();

    console.log('\nWith prefers-reduced-motion\n');
    const [reduced, closeReduced] = await open('reduce');

    const reducedTimings = (await reduced.evaluate(TIMING_SCRIPT)) as {
      worst: number;
      name: string;
    }[];
    const stillMoving = reducedTimings.filter((t) => t.worst > 1);
    check(
      'every duration on the page has collapsed',
      stillMoving.length === 0,
      stillMoving
        .slice(0, 3)
        .map((t) => `${t.name}=${t.worst}ms`)
        .join(', '),
    );

    /**
     * The check the masthead taught us to write. A collapsed duration on an
     * animation that STARTS at `opacity: 0` leaves the element invisible, not
     * still — so a reader who asked for no motion gets a blank page instead of
     * a calm one.
     */
    const visibleReduced = (await reduced.evaluate(VISIBILITY_SCRIPT)) as {
      name: string;
      opacity: number;
      transform: string;
    }[];
    check(
      'and nothing is left stranded at its starting frame',
      visibleReduced.length > 0 && visibleReduced.every((v) => v.opacity > 0.99),
      visibleReduced
        .filter((v) => v.opacity <= 0.99)
        .map((v) => `${v.name}=${v.opacity}`)
        .join(', '),
    );
    /**
     * Delays, checked separately from durations, because they fail differently.
     * A collapsed duration with `both` fill lands on the end frame and is
     * harmless; a surviving delay pins the element to its STARTING frame for
     * the length of the delay. That is the masthead bug, and it is the only
     * shape of this failure that is actually reachable.
     */
    const delays = (await reduced.evaluate(`(() => {
      const out = [];
      Array.from(document.querySelectorAll('body *')).forEach(function (el) {
        const s = getComputedStyle(el);
        const all = (s.animationDelay + ',' + s.transitionDelay)
          .split(',')
          .map(function (d) { return d.trim(); })
          .filter(Boolean)
          .map(function (d) { return d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000; })
          .filter(function (n) { return !Number.isNaN(n) && n > 1; });
        if (all.length) {
          out.push(el.tagName.toLowerCase() + (el.getAttribute('data-press') ? '[' + el.getAttribute('data-press') + ']' : '') + '=' + Math.max.apply(null, all) + 'ms');
        }
      });
      return out;
    })()`)) as string[];
    check(
      'and every delay has collapsed too — the shape that actually strands things',
      delays.length === 0,
      delays.slice(0, 3).join(', '),
    );

    check(
      'and nothing is left translated away from where it belongs',
      visibleReduced.every(
        (v) => v.transform === 'none' || v.transform === 'matrix(1, 0, 0, 1, 0, 0)',
      ),
      visibleReduced
        .filter((v) => v.transform !== 'none' && v.transform !== 'matrix(1, 0, 0, 1, 0, 0)')
        .map((v) => `${v.name}=${v.transform}`)
        .join(', '),
    );

    /**
     * The layout-shift proof. If every element sits in exactly the same place
     * with motion on and with motion off, then nothing animated is a property
     * that affects layout — which is the property this whole block promises.
     */
    const geometryReduced = (await reduced.evaluate(GEOMETRY_SCRIPT)) as Record<string, string>;
    const moved = Object.keys(geometryFull).filter(
      (k) => k in geometryReduced && geometryFull[k] !== geometryReduced[k],
    );
    check(
      'motion moves nothing: every element is in the same place either way',
      moved.length === 0,
      moved
        .slice(0, 3)
        .map((k) => `${k}: ${geometryFull[k]} vs ${geometryReduced[k]}`)
        .join(' · '),
    );

    await closeReduced();
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\nTest user cleaned up.');
  }

  console.log(
    failures === 0
      ? '\nMotion is tokenised, collapses completely, and shifts nothing.'
      : `\n${failures} motion check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-motion crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
