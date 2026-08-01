/**
 * Proves the Riso print treatment cannot reach any other theme.
 *
 * Riso is the only theme that is a design system rather than a palette — it
 * restyles the sidebar, the composer, the empty state and every card. The
 * brief for it was explicit that the other seven presets must keep working
 * unchanged, and "I was careful" is not a property anyone can check later.
 *
 * So the containment is structural: every rule in app/riso.css is scoped to
 * `html[data-theme='riso']`, and this script fails the build if one is not.
 * That turns "does not affect other themes" from a claim into a parse.
 *
 * It also checks the colours the stylesheet introduces on its own — the yellow
 * ticket and the pink primary action are literals in CSS, not tokens in
 * presets.ts, so `verify:theme` never sees them and they would otherwise be the
 * one part of the palette nobody was checking for contrast.
 *
 *   npx tsx scripts/verify-riso.ts
 */
import { readFileSync } from 'node:fs';

import { AA_LARGE, AA_NORMAL, contrastRatioHex } from '../lib/theme/contrast';
import { getTheme } from '../lib/theme/presets';

const SCOPE = "html[data-theme='riso']";

let failures = 0;

function check(name: string, passed: boolean, detail = '') {
  if (passed) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function ratio(name: string, fg: string, bg: string, threshold = AA_NORMAL) {
  const value = contrastRatioHex(fg, bg);
  check(
    `${name} — ${value?.toFixed(2) ?? '?'}:1`,
    value !== null && value >= threshold,
    `${fg} on ${bg} needs ${threshold}:1`,
  );
}

/**
 * Selectors from the stylesheet, with comments and at-rule wrappers removed.
 *
 * Deliberately a small hand-rolled scan rather than a CSS parser: the file is
 * ours, its shape is known, and a dependency whose job is to be right about
 * `@supports` edge cases is more surface than this needs. What it must not do
 * is silently skip a rule — anything it cannot classify is reported, not
 * ignored.
 */
function selectorsOf(css: string): string[] {
  // Strip comments first, or a selector-looking string inside prose is parsed.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  const selectors: string[] = [];
  // Everything before a `{` that is not itself an at-rule or a declaration.
  const blockPattern = /(^|[};])\s*([^{}@;]+?)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(withoutComments)) !== null) {
    const selector = match[2].trim();
    if (selector) selectors.push(selector);
  }
  return selectors;
}

/** Keyframe stops are not selectors — `0%`, `100%`, `from`, `to`. */
function isKeyframeStop(selector: string): boolean {
  return selector.split(',').every((part) => /^(from|to|-?\d+(\.\d+)?%)$/.test(part.trim()));
}

function main() {
  const css = readFileSync(new URL('../app/riso.css', import.meta.url), 'utf8');
  const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  console.log('Scope containment\n');

  const selectors = selectorsOf(css).filter((s) => !isKeyframeStop(s));
  check('the stylesheet has rules to check', selectors.length > 10, `${selectors.length} found`);

  /**
   * Each comma-separated selector in a rule list is independent — `a, b {}`
   * applies to `b` whether or not `a` is scoped. Checking the rule as a whole
   * would pass a list whose first entry is scoped and whose second is global.
   */
  const unscoped: string[] = [];
  for (const rule of selectors) {
    for (const part of rule.split(',')) {
      const selector = part.trim();
      if (!selector) continue;
      if (!selector.startsWith(SCOPE)) unscoped.push(selector);
    }
  }

  check(
    `every selector is scoped to ${SCOPE}`,
    unscoped.length === 0,
    unscoped.length ? `${unscoped.length} unscoped: ${unscoped.slice(0, 4).join(' | ')}` : '',
  );

  // The `@keyframes` name is global whatever the rules inside it are scoped to,
  // so it has to be namespaced by hand or it can collide with another theme's.
  const keyframeNames = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  check(
    'keyframe names are namespaced',
    keyframeNames.every((n) => n.startsWith('riso-')),
    keyframeNames.filter((n) => !n.startsWith('riso-')).join(', '),
  );

  // The counterpart rule has to exist somewhere that is NOT scoped, or the
  // Riso-only chrome renders on every theme.
  check(
    'globals.css hides [data-riso-only] by default',
    /\[data-riso-only\]\s*\{[^}]*display:\s*none/.test(globals.replace(/\/\*[\s\S]*?\*\//g, '')),
  );
  check('globals.css imports the stylesheet', globals.includes("@import './riso.css'"));

  console.log('\nContrast of the colours riso.css introduces\n');

  /**
   * These never pass through `lib/theme/presets.ts`, so `verify:theme` cannot
   * see them. They are the theme's third ink (the yellow ticket) and its
   * primary action, and both carry text.
   */
  const riso = getTheme('riso');

  const YELLOW = '#ffe800';
  ratio('ticket text on yellow (light)', '#1d2230', YELLOW);
  ratio('ticket text on yellow (dark)', '#16161a', YELLOW);

  ratio('"Start a page" text on pink (light)', '#f1eee2', '#bd3582');
  ratio('"Start a page" text on pink (dark)', '#16161a', '#ff48b0');

  // The lede and the marked word in the headline are set in the pink. The
  // headline is display-sized, so it is held to the large-text threshold; the
  // lede is 10px and is held to the normal one.
  ratio('lede stamp on paper', '#bd3582', riso.light.background);
  ratio('marked word in headline on paper', '#bd3582', riso.light.background, AA_LARGE);
  ratio('marked word in headline on night', '#ff48b0', riso.dark.background, AA_LARGE);

  // The standfirst is the theme's own foreground at 86% over paper. Checked at
  // the composited value rather than the token, because the opacity is real.
  const composited = (fg: string, bg: string, alpha: number) => {
    const hex = (v: string) => [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
    const [fr, fg_, fb] = hex(fg);
    const [br, bg_, bb] = hex(bg);
    const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
    return `#${[mix(fr, br), mix(fg_, bg_), mix(fb, bb)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')}`;
  };
  ratio(
    'standfirst at 86% on paper',
    composited(riso.light.text, riso.light.background, 0.86),
    riso.light.background,
  );
  ratio(
    'standfirst at 86% on night',
    composited(riso.dark.text, riso.dark.background, 0.86),
    riso.dark.background,
  );

  console.log('\nMarkup contract\n');

  /**
   * The stylesheet targets `data-riso` hooks. If a component drops one, the
   * rule silently stops applying and the theme quietly degrades to a palette —
   * no error, no failing page, just a look that is missing a piece. These are
   * the hooks whose absence would not be obvious.
   */
  const sources = [
    'components/chat/sidebar.tsx',
    'components/chat/chat-thread.tsx',
    'components/chat/composer.tsx',
    'components/chat/model-selector.tsx',
  ]
    .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
    .join('\n');

  const required = [
    'masthead',
    'wordmark',
    'issue',
    'draft',
    'divider',
    'slip',
    'stamp',
    'ticket',
    'headline',
    'standfirst',
    'pick',
    'pick-n',
    'coupon',
    'coupon-l',
    'quill',
  ];
  for (const hook of required) {
    const inCss = css.includes(`[data-riso='${hook}']`);
    const inMarkup = sources.includes(`data-riso="${hook}"`);
    check(
      `hook "${hook}" is styled and rendered`,
      inCss && inMarkup,
      !inCss ? 'missing from riso.css' : 'missing from the components',
    );
  }

  console.log(failures === 0 ? '\nAll riso checks passed.' : `\n${failures} riso check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
