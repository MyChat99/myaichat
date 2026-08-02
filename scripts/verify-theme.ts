/**
 * Holds every theme to WCAG AA.
 *
 * Runs against the token data directly, so it needs no browser and no running
 * server — and a new theme added to `presets.ts` is checked automatically
 * rather than needing a new test.
 *
 * Every pairing here is body text on a surface it actually appears on, so the
 * bar is AA normal (4.5:1). `textMuted` is included deliberately: it is
 * secondary text, not decoration, and exempting it is how "accessible" themes
 * ship with unreadable timestamps and captions.
 *
 *   npm run verify:theme
 */
import { AA_NORMAL, contrastRatioHex } from '../lib/theme/contrast';
import { ACCENT_PRESETS, THEMES, type ThemeTokens } from '../lib/theme/presets';

let failures = 0;
let checks = 0;

function check(label: string, ratio: number | null, minimum = AA_NORMAL) {
  checks++;
  if (ratio === null) {
    console.error(`  FAIL  ${label} — could not parse colours`);
    failures++;
    return;
  }

  const rounded = ratio.toFixed(2);
  if (ratio >= minimum) {
    console.log(`  ok    ${label.padEnd(46)} ${rounded}:1`);
  } else {
    console.error(`  FAIL  ${label.padEnd(46)} ${rounded}:1 (needs ${minimum}:1)`);
    failures++;
  }
}

function checkMode(themeLabel: string, mode: 'light' | 'dark', t: ThemeTokens) {
  const prefix = `${themeLabel}/${mode}`;

  // Primary text everywhere it lands.
  check(`${prefix}: text on background`, contrastRatioHex(t.text, t.background));
  check(`${prefix}: text on surface`, contrastRatioHex(t.text, t.surface));
  check(`${prefix}: text on surfaceHover`, contrastRatioHex(t.text, t.surfaceHover));

  // Secondary text — same bar, on purpose.
  check(`${prefix}: textMuted on background`, contrastRatioHex(t.textMuted, t.background));
  check(`${prefix}: textMuted on surface`, contrastRatioHex(t.textMuted, t.surface));

  // Text on the brand colour: buttons, the user's own message bubble.
  check(`${prefix}: accentForeground on accent`, contrastRatioHex(t.accentForeground, t.accent));

  // Error text has to be legible in exactly the moment things go wrong.
  check(`${prefix}: destructive on background`, contrastRatioHex(t.destructive, t.background));
  check(`${prefix}: success on background`, contrastRatioHex(t.success, t.background));
  check(`${prefix}: success on surface`, contrastRatioHex(t.success, t.surface));

  // The layout's own roles. Both carry text, so both are held to AA.
  check(`${prefix}: label on the second ink`, contrastRatioHex(t.accentAltForeground, t.accentAlt));
  check(`${prefix}: label on the overprint`, contrastRatioHex(t.overprintForeground, t.overprint));

  /**
   * The ink has to read as a keyline.
   *
   * This layout draws 2px rules and solid offset shadows in `border`. A polite
   * hairline that barely separates from the paper turns every card edge and
   * every shadow into something that looks like a rendering artefact rather
   * than a deliberate mark — which is the difference between "this newspaper in
   * rose inks" and "a rose theme that lost its design".
   *
   * 3:1 is WCAG 1.4.11's bar for a non-text element that carries meaning, and a
   * card boundary carries meaning.
   */
  check(`${prefix}: ink reads against the paper`, contrastRatioHex(t.border, t.background), 3);
  check(`${prefix}: ink reads against the stock`, contrastRatioHex(t.border, t.surface), 3);
}

console.log('WCAG AA contrast — every theme, both modes\n');

for (const theme of THEMES) {
  checkMode(theme.label, 'light', theme.light);
  checkMode(theme.label, 'dark', theme.dark);
  console.log('');
}

console.log('Accent presets (white text, as the picker renders them)\n');
for (const accent of ACCENT_PRESETS) {
  check(`accent "${accent.name}"`, contrastRatioHex('#ffffff', accent.hex));
}

console.log(
  failures === 0
    ? `\nAll ${checks} contrast checks passed.`
    : `\n${failures} of ${checks} contrast checks FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
