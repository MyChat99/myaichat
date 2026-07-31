import 'server-only';

import { createAdminClient } from '@/lib/db/admin';

/**
 * Everything the admin panel knows about one user's consumption.
 *
 * Kept separate from the users list because it is a fundamentally different
 * query shape: the list is one row per user with no joins, this is an
 * aggregation over usage_logs and messages for a single id. Loading it for
 * every row of the list — the "just add a column" instinct — turns one query
 * into N.
 */

export type ModelUsage = {
  modelId: string | null;
  displayName: string;
  providerName: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type DailyPoint = { date: string; messages: number; costUsd: number };

export type UserUsage = {
  totals: {
    conversations: number;
    messages: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  lastActiveAt: string | null;
  byModel: ModelUsage[];
  daily: DailyPoint[];
};

/** Bounds memory on a busy account. Named so the UI can say it was applied. */
export const USAGE_ROW_CAP = 50_000;

export async function getUserUsage(userId: string, days = 30): Promise<UserUsage> {
  const db = createAdminClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [usage, conversations, models, lastMessage] = await Promise.all([
    db
      .from('usage_logs')
      .select('model_id, input_tokens, output_tokens, estimated_cost, created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(USAGE_ROW_CAP),
    db.from('conversations').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    // Two flat queries joined in memory rather than a nested select: the
    // embedded form returns a SelectQueryError against this schema shape, and
    // fighting PostgREST's join syntax is not worth it for two small tables.
    db.from('models').select('id, display_name, provider_id'),
    db
      .from('usage_logs')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const { data: providers } = await db.from('providers').select('id, name');
  const providerById = new Map((providers ?? []).map((p) => [p.id, p.name]));
  const modelById = new Map(
    (models.data ?? []).map((m) => [
      m.id,
      { name: m.display_name, provider: providerById.get(m.provider_id) ?? 'unknown' },
    ]),
  );

  const rows = usage.data ?? [];

  const byModel = new Map<string, ModelUsage>();
  const byDay = new Map<string, DailyPoint>();

  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  for (const row of rows) {
    const cost = Number(row.estimated_cost);
    inputTokens += row.input_tokens;
    outputTokens += row.output_tokens;
    costUsd += cost;

    const key = row.model_id ?? 'unknown';
    const meta = row.model_id ? modelById.get(row.model_id) : undefined;
    const existing = byModel.get(key) ?? {
      modelId: row.model_id,
      // A deleted model still has usage rows attributed to it. Saying so beats
      // showing a blank cell or dropping the spend entirely.
      displayName: meta?.name ?? 'Deleted model',
      providerName: meta?.provider ?? 'unknown',
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };

    existing.messages += 1;
    existing.inputTokens += row.input_tokens;
    existing.outputTokens += row.output_tokens;
    existing.costUsd += cost;
    byModel.set(key, existing);

    const day = row.created_at.slice(0, 10);
    const point = byDay.get(day) ?? { date: day, messages: 0, costUsd: 0 };
    point.messages += 1;
    point.costUsd += cost;
    byDay.set(day, point);
  }

  return {
    totals: {
      conversations: conversations.count ?? 0,
      messages: rows.length,
      inputTokens,
      outputTokens,
      costUsd,
    },
    lastActiveAt: lastMessage.data?.created_at ?? null,
    byModel: [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd),
    daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
