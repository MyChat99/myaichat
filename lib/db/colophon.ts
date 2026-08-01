import 'server-only';

import { createClient } from '@/lib/db/server';

/**
 * The three figures printed at the foot of Riso's opening spread.
 *
 * The mockup sets a colophon there — notes set, ink used, presses running —
 * and it is the one part of that spread carrying real information rather than
 * invitation. Fabricating it would have been easy and would have made the whole
 * page decorative, so these are the reader's own numbers.
 *
 * Read through the request-scoped client, so row-level security scopes every
 * count to the signed-in user without an explicit filter. Costs are the user's
 * own spend, which is theirs to see; nothing here is admin data.
 */
export type Colophon = {
  /** Messages the user has exchanged, both directions. */
  notes: number;
  /** Their own estimated spend over the last 30 days, in USD. */
  spendUsd: number;
  /** Models available to send to. */
  presses: number;
};

export async function loadColophon(presses: number): Promise<Colophon> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // `head: true` with an exact count returns the number without the rows.
  const [messages, usage] = await Promise.all([
    supabase.from('messages').select('*', { count: 'exact', head: true }),
    supabase.from('usage_logs').select('estimated_cost').gte('created_at', since),
  ]);

  return {
    notes: messages.count ?? 0,
    spendUsd: (usage.data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost), 0),
    presses,
  };
}
