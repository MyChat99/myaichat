'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAdminClient } from '@/lib/db/admin';
import { createClient } from '@/lib/db/server';
import { deleteObject, isStorageConfigured, keyBelongsToUser } from '@/lib/r2/storage';
import { requireUser } from '@/lib/security/auth';
import { PRESET_COUNT, isUploadedKey, presetRef } from '@/lib/upload/urls';

const displayNameSchema = z.string().trim().min(1).max(60);
const keySchema = z.string().trim().min(1).max(512);

/**
 * Which mark, validated as an index rather than as the stored string.
 *
 * The caller sends a number and the server composes the `preset:N` value. If it
 * accepted the composed string instead, this boundary would have to parse a
 * format it also writes, and anything that got the format subtly wrong would be
 * stored and then silently fall back to the seeded mark at render — a bug that
 * looks like "my choice did not save" and leaves no trace.
 */
const presetSchema = z
  .number()
  .int()
  .min(0)
  .max(PRESET_COUNT - 1);

/**
 * Delete the object a profile used to point at, if it WAS an object.
 *
 * `profiles.avatar_url` holds either a storage key or a `preset:N` reference,
 * and handing the latter to `deleteObject` is a call that can only fail. Shared
 * by every path that replaces a portrait so the guard cannot be remembered in
 * one and forgotten in the next.
 */
async function releasePrevious(previous: string | null | undefined, next: string | null) {
  if (!isUploadedKey(previous) || previous === next || !isStorageConfigured()) return;
  try {
    await deleteObject(previous);
  } catch (err) {
    // An orphaned object is cheap; a failed portrait change is not.
    console.error('[profile] could not delete the previous avatar:', err);
  }
}

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

  await releasePrevious(existing?.avatar_url, parsed);

  revalidatePath('/', 'layout');
}

/**
 * Choose a generated mark.
 *
 * Mutually exclusive with an upload by construction: both states live in the
 * same column, so writing one necessarily clears the other. The uploaded object
 * is deleted as part of the switch — otherwise choosing a mark would leave a
 * photo of the reader sitting in the bucket, which is the wrong thing to do
 * with someone's face when they have just told you to stop showing it.
 */
export async function setPresetAvatar(index: number) {
  const user = await requireUser();
  const parsed = presetSchema.parse(index);
  const value = presetRef(parsed);

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  const { error } = await supabase.from('profiles').update({ avatar_url: value }).eq('id', user.id);

  if (error) throw new Error('Could not save your portrait.');

  await releasePrevious(existing?.avatar_url, value);

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

  // Guarded: after presets, this column is not always a storage key.
  await releasePrevious(existing?.avatar_url, null);

  revalidatePath('/', 'layout');
}
