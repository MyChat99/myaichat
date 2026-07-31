'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/db/server';
import { requireUser } from '@/lib/security/auth';
import { appearanceSchema, type Appearance } from '@/lib/theme/preferences';

/**
 * Saves appearance preferences.
 *
 * Writes through the user's own client, so RLS is what confines the update to
 * their row — this action never takes a user id from the caller.
 */
export async function saveAppearance(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();

  const parsed = appearanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Those appearance settings are not valid.' };
  }

  const a: Appearance = parsed.data;
  const supabase = await createClient();

  // upsert, not update: the signup trigger creates this row, but a user whose
  // row is somehow missing should still be able to set a theme.
  const { error } = await supabase.from('user_preferences').upsert(
    {
      user_id: user.id,
      theme: a.theme as never,
      preset_theme: a.presetTheme,
      accent_color: a.accentColor,
      font_size: a.fontSize as never,
      bubble_style: a.bubbleStyle as never,
    },
    { onConflict: 'user_id' },
  );

  if (error) return { ok: false, error: 'Could not save your preferences.' };

  // The theme is rendered by the root layout, so the whole tree must revalidate
  // for a reload to show the new one.
  revalidatePath('/', 'layout');
  return { ok: true };
}
