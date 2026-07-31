/**
 * Provider brand colours.
 *
 * Deliberately NOT theme tokens: a vendor's mark should look the same in every
 * theme, the way a logo does. Keeping them here rather than inline in a
 * component satisfies "no hardcoded colours in components" while being honest
 * that these are fixed brand values, not part of the design system.
 *
 * An unknown provider falls back to theme tokens, so a new provider needs no
 * entry to look reasonable.
 */
export const PROVIDER_BRAND: Record<string, { background: string; foreground: string }> = {
  anthropic: { background: '#d97757', foreground: '#ffffff' },
  openai: { background: '#10a37f', foreground: '#ffffff' },
};
