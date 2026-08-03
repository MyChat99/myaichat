import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/db/server';

/**
 * Conversation titles for the command palette.
 *
 * Titles only — the palette searches names, and pulling message bodies for a
 * search-as-you-type list would be wasteful. RLS scopes this to the caller.
 */
/**
 * Request-cached: the shell layout and the page inside it both render on the
 * same request, and the command palette asks for this on every page. Without
 * the cache it is one more round trip per navigation for a list that cannot
 * have changed between two components of the same render.
 */
export const listConversationTitles = cache(async function listConversationTitles(): Promise<
  { id: string; title: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('conversations')
    .select('id, title')
    .order('updated_at', { ascending: false })
    .limit(100);

  return data ?? [];
});
