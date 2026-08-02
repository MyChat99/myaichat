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
     * From the risograph mockup (docs/mockups/05-riso.html): newsprint stock
     * with a green undertone, two real Riso stock inks (Federal Blue and
     * Fluorescent Pink), and a third used exactly once (Yellow, on the model
     * pill).
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
      overprint: '#2f2f57',
      overprintForeground: '#f1eee2',
    },
  },
  {
    /** Default — the same press, neutral stock and a plain blue ink. */
    id: 'default',
    label: 'Default',
    light: {
      background: '#fafaf8',
      surface: '#f0f0ec',
      surfaceHover: '#e4e4de',
      border: '#17171a',
      accent: '#1d4ed8',
      accentForeground: '#ffffff',
      text: '#17171a',
      textMuted: '#56565e',
      destructive: '#b91c1c',
      success: '#166534',
      accentAlt: '#fcd34d',
      accentAltForeground: '#17171a',
      overprint: '#26264d',
      overprintForeground: '#fafaf8',
    },
    dark: {
      background: '#0b0b0d',
      surface: '#141417',
      surfaceHover: '#1d1d21',
      border: '#626270',
      accent: '#93b4ff',
      accentForeground: '#0b0b0d',
      text: '#f2f2f4',
      textMuted: '#a1a1ac',
      destructive: '#fca5a5',
      success: '#86efac',
      accentAlt: '#fcd34d',
      accentAltForeground: '#0b0b0d',
      overprint: '#2b2b52',
      overprintForeground: '#f2f2f4',
    },
  },
  {
    /** Midnight — indigo inks on a cool stock. */
    id: 'midnight',
    label: 'Midnight',
    light: {
      background: '#f4f5fb',
      surface: '#e8eaf6',
      surfaceHover: '#dcdff0',
      border: '#14152b',
      accent: '#3730a3',
      accentForeground: '#f4f5fb',
      text: '#14152b',
      textMuted: '#54587a',
      destructive: '#b3123c',
      success: '#0f766e',
      accentAlt: '#a5b4fc',
      accentAltForeground: '#14152b',
      overprint: '#2b2a63',
      overprintForeground: '#f4f5fb',
    },
    dark: {
      background: '#0b0b16',
      surface: '#14142a',
      surfaceHover: '#1c1c38',
      border: '#5e5e9d',
      accent: '#a5b4fc',
      accentForeground: '#0b0b16',
      text: '#e8e9f7',
      textMuted: '#a0a3c0',
      destructive: '#fb7185',
      success: '#5eead4',
      accentAlt: '#fcd34d',
      accentAltForeground: '#0b0b16',
      overprint: '#35356e',
      overprintForeground: '#e8e9f7',
    },
  },
  {
    /** Ocean — teal ink, warm yellow second plate. */
    id: 'ocean',
    label: 'Ocean',
    light: {
      background: '#f0fdfa',
      surface: '#dcf5f0',
      surfaceHover: '#c7ece4',
      border: '#0b2b2b',
      accent: '#0f766e',
      accentForeground: '#f0fdfa',
      text: '#0b2b2b',
      textMuted: '#456663',
      destructive: '#b3123c',
      success: '#166534',
      accentAlt: '#ffd166',
      accentAltForeground: '#0b2b2b',
      overprint: '#134445',
      overprintForeground: '#f0fdfa',
    },
    dark: {
      background: '#041414',
      surface: '#0a2222',
      surfaceHover: '#123030',
      border: '#3b7373',
      accent: '#5eead4',
      accentForeground: '#041414',
      text: '#e0f7f3',
      textMuted: '#8fb5b0',
      destructive: '#fb7185',
      success: '#86efac',
      accentAlt: '#ffd166',
      accentAltForeground: '#041414',
      overprint: '#14484a',
      overprintForeground: '#e0f7f3',
    },
  },
  {
    /** Forest — green ink, and a teal second plate so the two never merge. */
    id: 'forest',
    label: 'Forest',
    light: {
      background: '#f4faf4',
      surface: '#e5f1e5',
      surfaceHover: '#d4e7d4',
      border: '#12240f',
      accent: '#15803d',
      accentForeground: '#f4faf4',
      text: '#12240f',
      textMuted: '#4a6047',
      destructive: '#b91c1c',
      success: '#0f766e',
      accentAlt: '#f5d547',
      accentAltForeground: '#12240f',
      overprint: '#1d4023',
      overprintForeground: '#f4faf4',
    },
    dark: {
      background: '#0a1209',
      surface: '#121e10',
      surfaceHover: '#1a2a17',
      border: '#487143',
      accent: '#86efac',
      accentForeground: '#0a1209',
      text: '#e8f5e6',
      textMuted: '#9db89a',
      destructive: '#fca5a5',
      success: '#5eead4',
      accentAlt: '#f5d547',
      accentAltForeground: '#0a1209',
      overprint: '#1e4526',
      overprintForeground: '#e8f5e6',
    },
  },
  {
    /** Sunset — burnt orange ink on warm stock. */
    id: 'sunset',
    label: 'Sunset',
    light: {
      background: '#fff8f0',
      surface: '#ffecd8',
      surfaceHover: '#ffdfc0',
      border: '#2b1608',
      accent: '#c2410c',
      accentForeground: '#fff8f0',
      text: '#2b1608',
      textMuted: '#6a4732',
      destructive: '#b91c1c',
      success: '#166534',
      accentAlt: '#ffd166',
      accentAltForeground: '#2b1608',
      overprint: '#5a2412',
      overprintForeground: '#fff8f0',
    },
    dark: {
      background: '#180d05',
      surface: '#24160b',
      surfaceHover: '#322010',
      border: '#8e5b31',
      accent: '#fdba74',
      accentForeground: '#180d05',
      text: '#fdf0e2',
      textMuted: '#bfa084',
      destructive: '#fca5a5',
      success: '#86efac',
      accentAlt: '#ffd166',
      accentAltForeground: '#180d05',
      overprint: '#4d2812',
      overprintForeground: '#fdf0e2',
    },
  },
  {
    /** Rose — crimson ink on blush stock. The newspaper, in rose. */
    id: 'rose',
    label: 'Rose',
    light: {
      background: '#fff5f7',
      surface: '#ffe3ea',
      surfaceHover: '#ffcfda',
      border: '#2b0d16',
      accent: '#be123c',
      accentForeground: '#fff5f7',
      text: '#2b0d16',
      textMuted: '#6b424e',
      destructive: '#9f1239',
      success: '#166534',
      accentAlt: '#ffd166',
      accentAltForeground: '#2b0d16',
      overprint: '#5c1730',
      overprintForeground: '#fff5f7',
    },
    dark: {
      background: '#170811',
      surface: '#22101a',
      surfaceHover: '#2f1625',
      border: '#9b496d',
      accent: '#fda4af',
      accentForeground: '#170811',
      text: '#ffe9ef',
      textMuted: '#c99aa8',
      destructive: '#fb7185',
      success: '#86efac',
      accentAlt: '#ffd166',
      accentAltForeground: '#170811',
      overprint: '#4a1a2e',
      overprintForeground: '#ffe9ef',
    },
  },
  {
    /**
     * Mono — one ink.
     *
     * The second plate is a grey chip rather than a colour, because a
     * monochrome press does not suddenly find a yellow. It still has to be a
     * distinct field with a readable label, which is what accentAlt means here.
     */
    id: 'mono',
    label: 'Mono',
    light: {
      background: '#fbfbfb',
      surface: '#efefef',
      surfaceHover: '#e2e2e2',
      border: '#000000',
      accent: '#000000',
      accentForeground: '#ffffff',
      text: '#0a0a0a',
      textMuted: '#525252',
      destructive: '#7f1d1d',
      success: '#14532d',
      accentAlt: '#d4d4d4',
      accentAltForeground: '#0a0a0a',
      overprint: '#262626',
      overprintForeground: '#fbfbfb',
    },
    dark: {
      background: '#050505',
      surface: '#121212',
      surfaceHover: '#1e1e1e',
      border: '#626262',
      accent: '#fafafa',
      accentForeground: '#050505',
      text: '#f5f5f5',
      textMuted: '#a3a3a3',
      destructive: '#fca5a5',
      success: '#86efac',
      accentAlt: '#3f3f3f',
      accentAltForeground: '#f5f5f5',
      overprint: '#2e2e2e',
      overprintForeground: '#f5f5f5',
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
  theme: 'system' as const,
  // Riso is the product's visual identity, not the shadcn default.
  presetTheme: 'riso',
  // Follow the theme rather than override it. See THEME_ACCENT.
  accentColor: THEME_ACCENT,
  fontSize: 'md',
  bubbleStyle: 'bubbles',
};
