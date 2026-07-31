'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAdminClient } from '@/lib/db/admin';
import { createClient } from '@/lib/db/server';
import { deleteObject, isStorageConfigured, keyBelongsToUser } from '@/lib/r2/storage';
import { requireUser } from '@/lib/security/auth';

const displayNameSchema = z.string().trim().min(1).max(60);
const keySchema = z.string().trim().min(1).max(512);

export async function updateDisplayName(name: string) {
  const user = await requireUser();
  const parsed = displayNameSchema.parse(name);

  const supabase = await createClient();
  // RLS confines this to the caller's own row, and the Phase 4 trigger pins
  // `role` regardless of what is sent.
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: parsed })
    .eq('id', user.id);

  if (error) throw new Error('Could not update your name.');
  revalidatePath('/', 'layout');
}

/**
 * Points the profile at a newly uploaded avatar and deletes the old object.
 *
 * Cleanup happens AFTER the pointer moves: if deletion fails we are left with
 * an orphaned object, which is cheap. Doing it the other way round risks a
 * profile pointing at a file that no longer exists.
 */
export async function setAvatar(key: string) {
  const user = await requireUser();
  const parsed = keySchema.parse(key);

  if (!keyBelongsToUser(parsed, user.id)) {
    throw new Error('That file does not belong to you.');
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: parsed })
    .eq('id', user.id);

  if (error) throw new Error('Could not save your avatar.');

  const previous = existing?.avatar_url;
  if (previous && previous !== parsed && isStorageConfigured()) {
    try {
      await deleteObject(previous);
    } catch (err) {
      // Orphaned object, not a user-facing failure.
      console.error('[profile] could not delete the previous avatar:', err);
    }
  }

  revalidatePath('/', 'layout');
}

export async function removeAvatar() {
  const user = await requireUser();

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('profiles')
    .select('avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  const supabase = await createClient();
  await supabase.from('profiles').update({ avatar_url: null }).eq('id', user.id);

  if (existing?.avatar_url && isStorageConfigured()) {
    try {
      await deleteObject(existing.avatar_url);
    } catch (err) {
      console.error('[profile] could not delete the avatar object:', err);
    }
  }

  revalidatePath('/', 'layout');
}
