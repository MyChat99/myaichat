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
};

export type ThemeDefinition = {
  id: string;
  label: string;
  light: ThemeTokens;
  dark: ThemeTokens;
};

export const THEMES: ThemeDefinition[] = [
  {
    id: 'default',
    label: 'Default',
    light: {
      background: '#ffffff',
      surface: '#ffffff',
      surfaceHover: '#f4f4f5',
      border: '#e4e4e7',
      accent: '#18181b',
      accentForeground: '#fafafa',
      text: '#09090b',
      textMuted: '#52525b',
      destructive: '#b91c1c',
    },
    dark: {
      background: '#09090b',
      surface: '#18181b',
      surfaceHover: '#27272a',
      border: '#2f2f33',
      accent: '#fafafa',
      accentForeground: '#18181b',
      text: '#fafafa',
      textMuted: '#a1a1aa',
      destructive: '#f87171',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    light: {
      background: '#f8fafc',
      surface: '#ffffff',
      surfaceHover: '#f1f5f9',
      border: '#e2e8f0',
      accent: '#1e40af',
      accentForeground: '#ffffff',
      text: '#0f172a',
      textMuted: '#475569',
      destructive: '#b91c1c',
    },
    dark: {
      background: '#020617',
      surface: '#0f172a',
      surfaceHover: '#1e293b',
      border: '#26364c',
      accent: '#60a5fa',
      accentForeground: '#020617',
      text: '#f1f5f9',
      textMuted: '#94a3b8',
      destructive: '#f87171',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    light: {
      background: '#f0fdfa',
      surface: '#ffffff',
      surfaceHover: '#ccfbf1',
      border: '#99f6e4',
      accent: '#0f766e',
      accentForeground: '#ffffff',
      text: '#042f2e',
      textMuted: '#155e57',
      destructive: '#b91c1c',
    },
    dark: {
      background: '#04211f',
      surface: '#0b3330',
      surfaceHover: '#134e4a',
      border: '#1a5f5a',
      accent: '#2dd4bf',
      accentForeground: '#04211f',
      text: '#ecfdf5',
      textMuted: '#8fdcd0',
      destructive: '#f87171',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    light: {
      background: '#f6faf6',
      surface: '#ffffff',
      surfaceHover: '#e7f5e7',
      border: '#cfe8cf',
      accent: '#15803d',
      accentForeground: '#ffffff',
      text: '#0f2417',
      textMuted: '#2f5d3f',
      destructive: '#b91c1c',
    },
    dark: {
      background: '#0b1a10',
      surface: '#12261a',
      surfaceHover: '#1a3626',
      border: '#24462f',
      accent: '#4ade80',
      accentForeground: '#0b1a10',
      text: '#eaf6ee',
      textMuted: '#a0cfae',
      destructive: '#f87171',
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    light: {
      background: '#fffbf5',
      surface: '#ffffff',
      surfaceHover: '#ffedd5',
      border: '#fed7aa',
      accent: '#c2410c',
      accentForeground: '#ffffff',
      text: '#2c1608',
      textMuted: '#7c4a1d',
      destructive: '#b91c1c',
    },
    dark: {
      background: '#1c0f06',
      surface: '#2a180b',
      surfaceHover: '#3a2210',
      border: '#4a2d15',
      accent: '#fb923c',
      accentForeground: '#1c0f06',
      text: '#fff3e6',
      textMuted: '#e5ac7c',
      destructive: '#f87171',
    },
  },
  {
    id: 'rose',
    label: 'Rose',
    light: {
      background: '#fff5f7',
      surface: '#ffffff',
      surfaceHover: '#ffe4e9',
      border: '#fecdd3',
      accent: '#be123c',
      accentForeground: '#ffffff',
      text: '#2d0a14',
      textMuted: '#7d1f37',
      destructive: '#b91c1c',
    },
    dark: {
      background: '#1b0710',
      surface: '#2a0d19',
      surfaceHover: '#3d1424',
      border: '#4d1c2e',
      accent: '#fb7185',
      accentForeground: '#1b0710',
      text: '#ffeef2',
      textMuted: '#e79db1',
      destructive: '#f87171',
    },
  },
  {
    id: 'mono',
    label: 'Mono',
    light: {
      background: '#ffffff',
      surface: '#ffffff',
      surfaceHover: '#f5f5f5',
      border: '#d4d4d4',
      accent: '#000000',
      accentForeground: '#ffffff',
      text: '#000000',
      textMuted: '#525252',
      destructive: '#b91c1c',
    },
    dark: {
      background: '#000000',
      surface: '#121212',
      surfaceHover: '#1f1f1f',
      border: '#333333',
      accent: '#ffffff',
      accentForeground: '#000000',
      text: '#ffffff',
      textMuted: '#a3a3a3',
      destructive: '#f87171',
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
