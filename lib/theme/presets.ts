/**
 * Theme presets — data, not code.
 *
 * Adding a theme means adding one object here. Nothing else changes: the CSS
 * variables are generated from these tokens, `verify:theme` picks the new
 * entry up automatically and holds it to WCAG AA, and the appearance picker
 * lists it without edits.
 *
 * Values are hex on purpose. The contrast maths in `contrast.ts` needs
 * channel values it can read, and `oklch()` would mean shipping a colour-space
 * conversion just to check whether text is legible.
 */

export type ThemeTokens = {
  /** Page background. */
  background: string;
  /** Raised surfaces: cards, popovers, the sidebar. */
  surface: string;
  /** Hover/active state for interactive surfaces. */
  surfaceHover: string;
  border: string;
  /** Brand colour — buttons, the user's own message bubble, focus rings. */
  accent: string;
  /** Text ON the accent. Held to AA against it. */
  accentForeground: string;
  /** Primary body text. */
  text: string;
  /** Secondary text. Still body text, so still held to AA — not decorative. */
  textMuted: string;
  destructive: string;
  /** Positive confirmations: passing connection tests, saved states. */
  success: string;

  /**
   * The second ink. One highlight, used sparingly — the model pill.
   *
   * The layout reserves a place for a colour that is NOT the primary accent,
   * because a press sheet with one ink is a memo. Every palette has to answer
   * what its second plate is.
   */
  accentAlt: string;
  /** Text ON accentAlt. Held to AA against it. */
  accentAltForeground: string;

  /**
   * The second ink where it appears as large TYPE, not as a fill.
   *
   * Separate from `accentAlt` because a colour that works as a filled chip is
   * often unusable as text on the paper — Riso's yellow pill is the obvious
   * case, and Mono has no second ink at all, so it repeats its first.
   *
   * Held to 3:1 (WCAG AA for large text) against the paper.
   */
  display: string;

  /**
   * Where the two inks overlap: the selected conversation card.
   *
   * A selected item is overprinted rather than tinted, so it needs a colour of
   * its own rather than an opacity. Dark enough in light mode, and light enough
   * in dark mode, to reverse its label out of.
   */
  overprint: string;
  /** Text ON overprint. Held to AA against it. */
  overprintForeground: string;
};

export type ThemeDefinition = {
  id: string;
  label: string;
  light: ThemeTokens;
  dark: ThemeTokens;
};

export const THEMES: ThemeDefinition[] = [
  {
    /**
     * Riso — printed matter rather than emitted light, and the default.
     *
     * Newsprint stock with a green undertone, two real Riso stock inks
     * (Federal Blue and Fluorescent Pink), and a third used exactly once
     * (Yellow, on the model pill).
     *
     * Three colours were darkened from the mockup to clear AA, each along its
     * own hue rather than toward neutral, so the character survives:
     *   textMuted   #7a8094 → #606575  (21% darker)
     *   destructive #ff48b0 → #bd3582  (26% darker)
     *   success     #00a95c → #00753f  (31% darker, Riso Green)
     */
    id: 'riso',
    label: 'Riso',
    light: {
      background: '#f1eee2',
      surface: '#e8e4d5',
      surfaceHover: '#dedac9',
      border: '#1d2230',
      accent: '#3d5588',
      accentForeground: '#f1eee2',
      text: '#1d2230',
      textMuted: '#606575',
      destructive: '#bd3582',
      success: '#00753f',
      accentAlt: '#ffe800',
      accentAltForeground: '#1d2230',
      display: '#ed43a4',
      overprint: '#3d3d6e',
      overprintForeground: '#f1eee2',
    },
    dark: {
      background: '#16161a',
      surface: '#1e1e24',
      surfaceHover: '#26262e',
      border: '#68687d',
      accent: '#ff48b0',
      accentForeground: '#16161a',
      text: '#f1eee2',
      textMuted: '#9a9aa8',
      destructive: '#ff48b0',
      success: '#7fa3e0',
      accentAlt: '#ffe800',
      accentAltForeground: '#16161a',
      display: '#ff48b0',
      overprint: '#2f2f57',
      overprintForeground: '#f1eee2',
    },
  },
  {
    /**
     * Newsprint — grey stock, black ink, one loud red.
     *
     * The stock is genuinely grey (#d9d9d4), not a near-white pretending to be
     * paper. That single choice does more for the character than any accent
     * could: black type on grey reads as a printed page, and the red then has
     * something to shout against.
     */
    id: 'newsprint',
    label: 'Newsprint',
    light: {
      background: '#d9d9d4',
      surface: '#cfcfc9',
      surfaceHover: '#c2c2bb',
      border: '#111111',
      accent: '#111111',
      accentForeground: '#f5f5f0',
      text: '#111111',
      textMuted: '#4a4a45',
      destructive: '#a81409',
      success: '#1f5c34',
      accentAlt: '#d81c0e',
      accentAltForeground: '#ffffff',
      display: '#c8140b',
      overprint: '#4a1512',
      overprintForeground: '#f5f5f0',
    },
    dark: {
      background: '#1a1a18',
      surface: '#232320',
      surfaceHover: '#2d2d29',
      border: '#6f6f68',
      accent: '#f5f5f0',
      accentForeground: '#1a1a18',
      text: '#f5f5f0',
      textMuted: '#a8a8a0',
      destructive: '#ff6b5e',
      success: '#7fd39b',
      accentAlt: '#ff3b2f',
      accentAltForeground: '#1a1a18',
      display: '#ff3b2f',
      overprint: '#5a1a15',
      overprintForeground: '#f5f5f0',
    },
  },
  {
    /**
     * Blueprint — the paper is the ink.
     *
     * A cyanotype is white lines on deep blue, so this palette inverts the
     * usual arrangement even in LIGHT mode: the stock is #123a63 and the rules
     * are drawn in near-white. It is the one palette where "light" does not
     * mean "pale", and it is included precisely because the layout should be
     * able to survive that.
     */
    id: 'blueprint',
    label: 'Blueprint',
    light: {
      background: '#123a63',
      surface: '#16456f',
      surfaceHover: '#1b507e',
      border: '#cfe4f5',
      accent: '#ffffff',
      accentForeground: '#123a63',
      text: '#e8f2fb',
      textMuted: '#a8c6de',
      destructive: '#ff9d94',
      success: '#8fe8c8',
      accentAlt: '#29d2ff',
      accentAltForeground: '#06202f',
      display: '#29d2ff',
      overprint: '#0a2745',
      overprintForeground: '#e8f2fb',
    },
    dark: {
      background: '#071a2e',
      surface: '#0c2540',
      surfaceHover: '#123050',
      border: '#5b97cc',
      accent: '#29d2ff',
      accentForeground: '#071a2e',
      text: '#dcecf9',
      textMuted: '#97bcd8',
      destructive: '#ff9d94',
      success: '#8fe8c8',
      accentAlt: '#ffffff',
      accentAltForeground: '#071a2e',
      display: '#29d2ff',
      overprint: '#103457',
      overprintForeground: '#dcecf9',
    },
  },
  {
    /**
     * Pulp — warm tan stock, brown ink, vermilion.
     *
     * Cheap paperback paper that has gone slightly acid with age. The two inks
     * are separated by hue as well as value — a dark brown against a vermilion
     * that leans red, so they read as two plates rather than as one colour at
     * two strengths.
     */
    id: 'pulp',
    label: 'Pulp',
    light: {
      background: '#e8dcc0',
      surface: '#ddd0b0',
      surfaceHover: '#d0c19d',
      border: '#3a2313',
      accent: '#6b3f1d',
      accentForeground: '#f5ecd8',
      text: '#3a2313',
      textMuted: '#6a5236',
      destructive: '#a02a12',
      success: '#33591f',
      accentAlt: '#c4441f',
      accentAltForeground: '#ffffff',
      display: '#c4441f',
      overprint: '#5a2a12',
      overprintForeground: '#f5ecd8',
    },
    dark: {
      background: '#191009',
      surface: '#241809',
      surfaceHover: '#30210f',
      border: '#8a6136',
      accent: '#e9a33d',
      accentForeground: '#191009',
      text: '#f2e2c6',
      textMuted: '#b99f76',
      destructive: '#ff8563',
      success: '#9dcf7a',
      accentAlt: '#e2603a',
      accentAltForeground: '#191009',
      display: '#e2603a',
      overprint: '#4d2a13',
      overprintForeground: '#f2e2c6',
    },
  },
  {
    /**
     * Neon — electric green and magenta.
     *
     * This palette lives in the dark, and says so. The dark variant is the real
     * thing: near-black with two inks that could not exist on paper. The light
     * variant is its daytime printing — the same two hues taken down until they
     * are legible on a pale acid stock, because a palette still has to work for
     * someone who asked for light.
     */
    id: 'neon',
    label: 'Neon',
    light: {
      background: '#eef5ea',
      surface: '#e0ecda',
      surfaceHover: '#d0e0c8',
      border: '#0d1a0d',
      accent: '#0f7a35',
      accentForeground: '#eef5ea',
      text: '#0d1a0d',
      textMuted: '#4b5c4b',
      destructive: '#b3126b',
      success: '#0a6e4e',
      accentAlt: '#c2187a',
      accentAltForeground: '#ffffff',
      display: '#c2187a',
      overprint: '#123a2a',
      overprintForeground: '#eef5ea',
    },
    dark: {
      background: '#050806',
      surface: '#0c120d',
      surfaceHover: '#141d15',
      border: '#4e7552',
      accent: '#39ff88',
      accentForeground: '#050806',
      text: '#e8ffe9',
      textMuted: '#94bd99',
      destructive: '#ff3ba7',
      success: '#7fe3c0',
      accentAlt: '#ff3ba7',
      accentAltForeground: '#050806',
      display: '#ff3ba7',
      overprint: '#1d3d2c',
      overprintForeground: '#e8ffe9',
    },
  },
  {
    /**
     * Botanical — cream, deep forest green, terracotta.
     *
     * A field guide rather than a poster: the stock is warm, the first ink is
     * almost black-green, and the second is a fired clay that stops the whole
     * thing reading as one colour.
     */
    id: 'botanical',
    label: 'Botanical',
    light: {
      background: '#f5f0e1',
      surface: '#e9e2cd',
      surfaceHover: '#dbd2ba',
      border: '#16261a',
      accent: '#1f4d2e',
      accentForeground: '#f5f0e1',
      text: '#16261a',
      textMuted: '#50604d',
      destructive: '#a33a22',
      success: '#2f6f4f',
      accentAlt: '#c4643c',
      accentAltForeground: '#1a0f08',
      display: '#b0522c',
      overprint: '#23402a',
      overprintForeground: '#f5f0e1',
    },
    dark: {
      background: '#0b120c',
      surface: '#131c14',
      surfaceHover: '#1c281d',
      border: '#57795b',
      accent: '#86c58f',
      accentForeground: '#0b120c',
      text: '#e9f0e5',
      textMuted: '#9cb09a',
      destructive: '#e08a6a',
      success: '#7fd0b0',
      accentAlt: '#e0855c',
      accentAltForeground: '#0b120c',
      display: '#e0855c',
      overprint: '#24422c',
      overprintForeground: '#e9f0e5',
    },
  },
  {
    /**
     * Mono — pure white, pure black, one yellow.
     *
     * Brutalist: nothing is softened. The stock is #ffffff and the ink is
     * #000000, with no tint in either, so the 2px rules are as hard as the
     * screen can draw them. The yellow is the only colour in the palette and it
     * appears exactly once, on the model pill.
     */
    id: 'mono',
    label: 'Mono',
    light: {
      background: '#ffffff',
      surface: '#f2f2f2',
      surfaceHover: '#e4e4e4',
      border: '#000000',
      accent: '#000000',
      accentForeground: '#ffffff',
      text: '#000000',
      textMuted: '#4d4d4d',
      destructive: '#b00000',
      success: '#056600',
      accentAlt: '#ffdd00',
      accentAltForeground: '#000000',
      display: '#000000',
      overprint: '#1a1a1a',
      overprintForeground: '#ffffff',
    },
    dark: {
      background: '#000000',
      surface: '#0d0d0d',
      surfaceHover: '#1a1a1a',
      border: '#6b6b6b',
      accent: '#ffffff',
      accentForeground: '#000000',
      text: '#ffffff',
      textMuted: '#a6a6a6',
      destructive: '#ff6b6b',
      success: '#6bff8f',
      accentAlt: '#ffdd00',
      accentAltForeground: '#000000',
      display: '#ffffff',
      overprint: '#262626',
      overprintForeground: '#ffffff',
    },
  },
];

export const THEME_IDS = THEMES.map((t) => t.id);
export type ThemeId = (typeof THEMES)[number]['id'];

export function getTheme(id: string): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/**
 * Accent presets for the picker. Each is held to AA against white text by
 * `verify:theme`, so the swatches are all safe choices; a custom hex is
 * checked live in the picker instead.
 */
/**
 * The accent value meaning "whatever ink this theme uses".
 *
 * A theme defines its own accent per mode, and for a theme with a point of view
 * that accent IS the theme — Riso's is Federal Blue on paper and Fluorescent
 * Pink at night. A named preset overrides both with one colour in both modes,
 * which is the right behaviour when someone has *chosen* a colour and the wrong
 * default: it means the out-of-the-box look is a theme with its own identity
 * painted over in generic blue.
 *
 * Resolving this to `null` is what makes it work — `withAccent(tokens, null)`
 * returns the theme's tokens untouched, so each mode keeps its own ink. It is a
 * plain lowercase word, so the existing column CHECK and Zod pattern already
 * admit it; nothing about validation changes.
 */
export const THEME_ACCENT = 'theme';

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: 'slate', hex: '#475569' },
  { name: 'blue', hex: '#1d4ed8' },
  { name: 'violet', hex: '#6d28d9' },
  { name: 'teal', hex: '#0f766e' },
  { name: 'green', hex: '#15803d' },
  { name: 'amber', hex: '#b45309' },
  { name: 'orange', hex: '#c2410c' },
  { name: 'rose', hex: '#be123c' },
];

export const FONT_SIZES = [
  { id: 'sm', label: 'Small', rootPx: 14 },
  { id: 'md', label: 'Medium', rootPx: 16 },
  { id: 'lg', label: 'Large', rootPx: 18 },
] as const;

export const BUBBLE_STYLES = [
  { id: 'bubbles', label: 'Bubbles' },
  { id: 'flat', label: 'Document' },
] as const;

/**
 * What a visitor with no stored preference is rendered with.
 *
 * Lives here rather than in preferences.ts because that module is
 * `server-only`, and this value has to be readable by anything that checks the
 * application and the database agree about the default. They are two separate
 * facts — the column decides what a new row gets, this decides what a
 * signed-out visitor sees — and if they drift, someone sees one theme before
 * signing in and another after.
 *
 * `verify:appearance` asserts they match.
 */
export const DEFAULT_APPEARANCE = {
  // Annotated so it stays the literal union member rather than widening to
  // `string` — this object has to satisfy `Appearance`, and a widened `theme`
  // would not.
  /**
   * Newsprint light, deliberately, and for the FRONT DOOR as much as anything.
   *
   * This is the default for a signed-out visitor and for a new account alike —
   * one default, not two. It was `system`/`riso`, which meant anyone arriving
   * with a dark OS met a dark pink login page: a striking screen, but not the
   * letterpress the product is. Newsprint light is the brand at its plainest,
   * which is what a front door should be.
   *
   * `light` rather than `system` for the same reason: the first impression
   * should not depend on the visitor's OS setting. Anyone who wants Riso dark
   * chooses it in Appearance, and that choice is respected everywhere after.
   */
  theme: 'light' as const,
  presetTheme: 'newsprint',
  // Follow the theme rather than override it. See THEME_ACCENT.
  accentColor: THEME_ACCENT,
  fontSize: 'md',
  bubbleStyle: 'bubbles',
};
