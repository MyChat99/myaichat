'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createClient } from '@/lib/db/server';
import { requireUser } from '@/lib/security/auth';

/**
 * Editions — a gathering of pages.
 *
 * ## Authorisation
 *
 * Every mutation goes through the cookie-bound client, so **RLS is the actual
 * check** and these actions never assert ownership themselves. That is the same
 * arrangement conversations use, and it is deliberate: a server action that
 * checks ownership itself is one `.eq('user_id', …)` away from being wrong, and
 * the check lives in a place a second caller could forget.
 *
 * Two things RLS does NOT cover, both handled in the database:
 *
 *  - a conversation pointing at ANOTHER user's edition. That write is against a
 *    `conversations` row the user legitimately owns, so the policy has no
 *    opinion about the value of the column. A `SECURITY DEFINER` trigger
 *    rejects it, and it holds for the service role too.
 *  - deleting an edition must RELEASE its pages, not delete them. That is
 *    `on delete set null` in the schema rather than logic here, so it holds for
 *    every path — including ones that do not exist yet.
 *
 * ## The thing that would have been silently destructive
 *
 * The sidebar groups pages under date headings by `conversations.updated_at`,
 * and `conversations_set_updated_at` used to restamp the row on EVERY update.
 * Releasing a page — an UPDATE — would have moved it to "Today", so deleting an
 * edition would have quietly rewritten the reader's history while looking like
 * it worked. The trigger now skips when the only change is membership. See
 * `20260803210000_editions.sql`.
 */

const idSchema = z.string().uuid();
/** Matches the `editions_name_not_blank` CHECK, so the two cannot drift. */
const nameSchema = z.string().trim().min(1).max(80);

export async function createEdition(name: string): Promise<string> {
  const user = await requireUser();
  const parsed = nameSchema.parse(name);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('editions')
    .insert({ user_id: user.id, name: parsed })
    .select('id')
    .single();

  if (error || !data) throw new Error('Could not create that edition.');

  revalidatePath('/', 'layout');
  return data.id;
}

export async function renameEdition(id: string, name: string) {
  await requireUser();
  const parsedId = idSchema.parse(id);
  const parsedName = nameSchema.parse(name);

  const supabase = await createClient();
  const { error } = await supabase.from('editions').update({ name: parsedName }).eq('id', parsedId);

  if (error) throw new Error('Could not rename that edition.');
  revalidatePath('/', 'layout');
}

/**
 * Delete an edition. Its pages come loose; none of them are deleted.
 *
 * No `update … set edition_id = null` here on purpose. The foreign key does it,
 * which means it is true for a delete issued from anywhere — psql, a future
 * admin screen, a cascade from removing the account — rather than only for
 * deletes that happen to come through this function.
 */
export async function deleteEdition(id: string) {
  await requireUser();
  const parsed = idSchema.parse(id);

  const supabase = await createClient();
  const { error } = await supabase.from('editions').delete().eq('id', parsed);

  if (error) throw new Error('Could not delete that edition.');
  revalidatePath('/', 'layout');
}

/**
 * Put a page in an edition, move it between editions, or take it out.
 *
 * One action for all three, because they are one write. Separate `assign` and
 * `remove` actions would be two spellings of `update … set edition_id = ?`, and
 * a "move" would be neither or both.
 */
export async function setConversationEdition(conversationId: string, editionId: string | null) {
  await requireUser();
  const parsedConversation = idSchema.parse(conversationId);
  const parsedEdition = editionId === null ? null : idSchema.parse(editionId);

  const supabase = await createClient();
  const { error } = await supabase
    .from('conversations')
    .update({ edition_id: parsedEdition })
    .eq('id', parsedConversation);

  if (error) {
    // The database trigger raises when the edition belongs to someone else.
    // Reported as a refusal rather than a crash, and without echoing the id —
    // "that edition is not yours" answers a question about what exists.
    throw new Error('Could not move that page.');
  }

  revalidatePath('/', 'layout');
}
