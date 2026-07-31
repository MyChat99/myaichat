'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/db/server';
import { defaultModel, resolveModel } from '@/lib/providers/registry';
import { requireUser } from '@/lib/security/auth';

/**
 * Conversation CRUD.
 *
 * Every mutation goes through the cookie-bound client, so RLS is the actual
 * authorisation check — these actions never assert ownership themselves.
 */

const idSchema = z.string().uuid();
const titleSchema = z.string().trim().min(1).max(200);

async function insertConversation(preferredModelId?: string): Promise<string> {
  const user = await requireUser();
  const supabase = await createClient();

  // Honour a model chosen in the selector before the first send; otherwise take
  // the registry default. Both go through resolveModel so a disabled or
  // adapter-less model can't be pinned.
  const model = preferredModelId
    ? ((await resolveModel(preferredModelId)) ?? (await defaultModel()))
    : await defaultModel();

  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: user.id, title: 'New chat', model_id: model?.id ?? null })
    .select('id')
    .single();

  if (error || !data) throw new Error('Could not create conversation.');
  return data.id;
}

/** Sidebar "New chat" button — navigates to the new thread. */
export async function createConversation() {
  const id = await insertConversation();
  revalidatePath('/', 'layout');
  redirect(`/c/${id}`);
}

/**
 * Used by the composer on the root page, where a conversation only comes into
 * existence once the user actually sends something — so browsing to `/` does
 * not litter the sidebar with empty threads.
 */
export async function createConversationForMessage(preferredModelId?: string): Promise<string> {
  const id = await insertConversation(preferredModelId);
  revalidatePath('/', 'layout');
  return id;
}

/**
 * Pins a model to a conversation. Subsequent messages use it; earlier replies
 * are left alone, so a thread can legitimately contain answers from more than
 * one model.
 */
export async function setConversationModel(id: string, modelId: string) {
  await requireUser();
  const parsedId = idSchema.parse(id);
  const parsedModelId = idSchema.parse(modelId);

  // Validate against the registry rather than trusting the id: this rejects a
  // model that is disabled, or whose provider has no adapter.
  const model = await resolveModel(parsedModelId);
  if (!model) throw new Error('That model is not available.');

  const supabase = await createClient();
  await supabase.from('conversations').update({ model_id: parsedModelId }).eq('id', parsedId);

  revalidatePath('/', 'layout');
}

export async function renameConversation(id: string, title: string) {
  await requireUser();
  const parsedId = idSchema.parse(id);
  const parsedTitle = titleSchema.parse(title);

  const supabase = await createClient();
  await supabase.from('conversations').update({ title: parsedTitle }).eq('id', parsedId);

  revalidatePath('/', 'layout');
}

export async function togglePin(id: string, pinned: boolean) {
  await requireUser();
  const parsedId = idSchema.parse(id);

  const supabase = await createClient();
  await supabase.from('conversations').update({ pinned }).eq('id', parsedId);

  revalidatePath('/', 'layout');
}

export async function deleteConversation(id: string) {
  await requireUser();
  const parsedId = idSchema.parse(id);

  const supabase = await createClient();
  await supabase.from('conversations').delete().eq('id', parsedId);

  revalidatePath('/', 'layout');
  redirect('/');
}
