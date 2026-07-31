import 'server-only';

import { createClient } from '@/lib/db/server';

/**
 * Conversation titles for the command palette.
 *
 * Titles only — the palette searches names, and pulling message bodies for a
 * search-as-you-type list would be wasteful. RLS scopes this to the caller.
 */
export async function listConversationTitles(): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('conversations')
    .select('id, title')
    .order('updated_at', { ascending: false })
    .limit(100);

  return data ?? [];
}
