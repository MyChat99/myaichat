import 'server-only';

import { cache } from 'react';
import { z } from 'zod';

import { createClient } from '@/lib/db/server';
import {
  ACCENT_PRESETS,
  BUBBLE_STYLES,
  DEFAULT_APPEARANCE,
  FONT_SIZES,
  THEME_ACCENT,
  THEME_IDS,
} from './presets';

// Re-exported so existing server-side imports keep working. The constant
// itself lives in presets.ts, which is client-safe — a `server-only` module
// cannot be read by the test that has to prove the app and the database agree
// about what the default is.
export { DEFAULT_APPEARANCE };

/**
 * Appearance preferences, read server-side so the correct theme is in the
 * initial HTML rather than applied after paint.
 */

export const appearanceSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  presetTheme: z.enum(THEME_IDS as [string, ...string[]]),
  // A named preset or a #rrggbb value. Mirrors the DB CHECK constraint.
  accentColor: z.string().regex(/^(#[0-9a-fA-F]{6}|[a-z]+)$/),
  fontSize: z.enum(FONT_SIZES.map((f) => f.id) as [string, ...string[]]),
  bubbleStyle: z.enum(BUBBLE_STYLES.map((b) => b.id) as [string, ...string[]]),
});

export type Appearance = z.infer<typeof appearanceSchema>;

/**
 * Loads the signed-in user's appearance, falling back to defaults.
 *
 * Never throws: the root layout renders on every request including the signed-
 * out ones, and a preferences problem must not take down the whole app. A bad
 * stored value degrades to the default rather than blanking the page.
 */
export const loadAppearance = cache(async function loadAppearance(): Promise<Appearance> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return DEFAULT_APPEARANCE;

    const { data } = await supabase
      .from('user_preferences')
      .select('theme, preset_theme, accent_color, font_size, bubble_style')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!data) return DEFAULT_APPEARANCE;

    const parsed = appearanceSchema.safeParse({
      theme: data.theme,
      presetTheme: data.preset_theme,
      accentColor: data.accent_color,
      fontSize: data.font_size,
      bubbleStyle: data.bubble_style,
    });

    return parsed.success ? parsed.data : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
});

/**
 * Resolves a named accent preset to hex; passes a hex value straight through.
 *
 * `null` means "do not override the theme" — returned for THEME_ACCENT, and for
 * any unrecognised name. Falling back to the theme rather than to a hardcoded
 * colour is deliberate: an unknown value is most likely a preset that was
 * renamed or removed, and the theme's own accent is always a defensible answer
 * where an arbitrary blue is not.
 */
export function accentToHex(accent: string): string | null {
  if (accent === THEME_ACCENT) return null;
  if (accent.startsWith('#')) return accent;
  return ACCENT_PRESETS.find((a) => a.name === accent)?.hex ?? null;
}
