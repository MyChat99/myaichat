'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/db/server';
import { requireUser } from '@/lib/security/auth';

/**
 * Conversation CRUD.
 *
 * Every mutation goes through the cookie-bound client, so RLS is the actual
 * authorisation check — these actions never assert ownership themselves.
 */

const idSchema = z.string().uuid();
const titleSchema = z.string().trim().min(1).max(200);

async function insertConversation(): Promise<string> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: model } = await supabase
    .from('models')
    .select('id')
    .eq('enabled', true)
    .limit(1)
    .maybeSingle();

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
export async function createConversationForMessage(): Promise<string> {
  const id = await insertConversation();
  revalidatePath('/', 'layout');
  return id;
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
