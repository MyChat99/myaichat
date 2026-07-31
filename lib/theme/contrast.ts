/**
 * WCAG 2.1 contrast maths.
 *
 * Pure and dependency-free so it can run in three places that matter: the
 * accent picker (live ratio as you type), the theme authoring (`verify:theme`
 * asserts AA across every theme × mode), and the server when deriving a
 * readable foreground for a custom accent.
 *
 * Reference: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

export type Rgb = { r: number; g: number; b: number };

/** AA for body text. AAA is 7; large text relaxes to 3. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

export function parseHex(hex: string): Rgb | null {
  const clean = hex.trim().replace(/^#/, '');

  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Relative luminance.
 *
 * The 0.03928 branch is the sRGB gamma curve, not an approximation — dropping
 * it (as "perceived brightness" formulas do) gives wrong ratios for dark
 * colours, which is exactly where our dark themes live.
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastRatioHex(a: string, b: string): number | null {
  const rgbA = parseHex(a);
  const rgbB = parseHex(b);
  if (!rgbA || !rgbB) return null;
  return contrastRatio(rgbA, rgbB);
}

/**
 * Picks black or white text for a background, whichever contrasts more.
 *
 * This is what keeps a user-chosen accent legible. It cannot always reach AA —
 * a mid-tone accent tops out around 4.4 against both — so the picker surfaces
 * the resulting ratio rather than pretending every choice is fine.
 */
export function readableForeground(background: Rgb): Rgb {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  return contrastRatio(background, black) >= contrastRatio(background, white) ? black : white;
}

export function meetsAA(ratio: number, large = false): boolean {
  return ratio >= (large ? AA_LARGE : AA_NORMAL);
}
