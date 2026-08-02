import { parseHex, readableForeground, toHex } from './contrast';
import { getTheme, type ThemeTokens } from './presets';

/**
 * Turns theme tokens into the CSS custom properties the app already uses.
 *
 * ⚠️ NAMING COLLISION, worth knowing before editing this file: shadcn's
 * `--accent` means "hover/active surface", NOT the brand colour. Our brand
 * accent maps to `--primary`. Getting this backwards makes every button the
 * colour of a hover state.
 *
 * Mapping onto the existing variable names is deliberate: it means no Phase
 * 1–4 component has to change to become themeable, which is the smallest
 * possible edit to working code.
 */

const MAP: Record<string, keyof ThemeTokens> = {
  '--background': 'background',
  '--foreground': 'text',

  '--card': 'surface',
  '--card-foreground': 'text',
  '--popover': 'surface',
  '--popover-foreground': 'text',

  // Brand colour → --primary (see the collision note above).
  '--primary': 'accent',
  '--primary-foreground': 'accentForeground',

  '--secondary': 'surfaceHover',
  '--secondary-foreground': 'text',
  '--muted': 'surfaceHover',
  '--muted-foreground': 'textMuted',

  // shadcn's hover surface.
  '--accent': 'surfaceHover',
  '--accent-foreground': 'text',

  '--destructive': 'destructive',
  '--success': 'success',
  '--border': 'border',
  '--input': 'border',
  '--ring': 'accent',

  '--sidebar': 'surface',
  '--sidebar-foreground': 'text',
  '--sidebar-primary': 'accent',
  '--sidebar-primary-foreground': 'accentForeground',
  '--sidebar-accent': 'surfaceHover',
  '--sidebar-accent-foreground': 'text',
  '--sidebar-border': 'border',
  '--sidebar-ring': 'accent',

  // The layout's own roles. These are not shadcn's — the press design needs a
  // second ink and an overprint, and every palette must answer for both.
  '--accent-alt': 'accentAlt',
  '--accent-alt-foreground': 'accentAltForeground',
  '--overprint': 'overprint',
  '--overprint-foreground': 'overprintForeground',
};

function block(tokens: ThemeTokens): string {
  return Object.entries(MAP)
    .map(([cssVar, token]) => `${cssVar}:${tokens[token]}`)
    .join(';');
}

/**
 * Applies a custom accent, deriving a readable foreground for it.
 *
 * Returns the tokens unchanged for an unparseable value rather than throwing —
 * a malformed preference should not blank the page.
 */
function withAccent(tokens: ThemeTokens, accentHex: string | null): ThemeTokens {
  if (!accentHex) return tokens;

  const rgb = parseHex(accentHex);
  if (!rgb) return tokens;

  return {
    ...tokens,
    accent: toHex(rgb),
    accentForeground: toHex(readableForeground(rgb)),
  };
}

/**
 * The full stylesheet for one preset, both modes.
 *
 * Emitting BOTH modes is what makes zero-flash possible: the light/dark choice
 * becomes a class toggle the pre-paint script can make, with no second render
 * and no request.
 */
export function themeCss(presetId: string, accentHex: string | null): string {
  const theme = getTheme(presetId);

  const light = block(withAccent(theme.light, accentHex));
  const dark = block(withAccent(theme.dark, accentHex));

  return `:root{${light}}.dark{${dark}}`;
}

export const FONT_SIZE_PX: Record<string, number> = { sm: 14, md: 16, lg: 18 };

export function rootFontSize(fontSize: string): number {
  return FONT_SIZE_PX[fontSize] ?? FONT_SIZE_PX.md;
}
