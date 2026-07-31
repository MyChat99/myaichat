import { createAdminClient } from '@/lib/db/admin';
import { requireAdmin } from '@/lib/security/auth';

import { AnalyticsCharts, type AnalyticsData } from './analytics-client';

/**
 * Usage analytics.
 *
 * Aggregation happens HERE, on the server, not in the chart component: sending
 * 10k raw usage rows to the browser to be grouped client-side is what makes
 * dashboards fall over as data grows. Only the aggregates cross the wire.
 */

const RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const;
type RangeKey = keyof typeof RANGES;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Data loading lives outside the component on purpose: React's purity lint
 * (correctly) rejects `Date.now()` during render, and time-bucketed analytics
 * cannot avoid reading the clock. A plain async function is the honest home
 * for it, and it keeps the component to rendering.
 */
async function loadAnalytics(range: RangeKey): Promise<AnalyticsData> {
  const days = RANGES[range];
  // Captured once. The lint rule flags repeated Date.now() calls during render
  // as impure — and it is right that every bucket boundary should derive from a
  // single instant, or a request spanning midnight would produce a gap.
  const now = Date.now();
  const since = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  const db = createAdminClient();

  const [{ data: usage }, { data: models }, { data: providers }] = await Promise.all([
    db
      .from('usage_logs')
      .select('created_at, user_id, model_id, input_tokens, output_tokens, estimated_cost')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      // A hard ceiling so one pathological range cannot exhaust memory. If it
      // is ever hit the page says so rather than silently showing a subset.
      .limit(50_000),
    db.from('models').select('id, display_name, provider_id'),
    db.from('providers').select('id, name'),
  ]);

  const rows = usage ?? [];

  // Two flat queries and a join in memory, rather than a nested select: the
  // embedded-resource form does not type cleanly here, and both tables are
  // small enough that this is cheaper than fighting the query builder.
  const providerName = new Map((providers ?? []).map((p) => [p.id, p.name]));
  const modelById = new Map(
    (models ?? []).map((m) => [
      m.id,
      { name: m.display_name, provider: providerName.get(m.provider_id) ?? 'unknown' },
    ]),
  );

  // --- messages per day, with empty days filled so the axis is continuous ---
  const perDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    perDay.set(dayKey(new Date(now - i * 86_400_000).toISOString()), 0);
  }
  for (const row of rows) {
    const key = dayKey(row.created_at);
    if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  // --- tokens by model, cost by provider ---
  const byModel = new Map<string, { input: number; output: number }>();
  const byProvider = new Map<string, number>();
  const activeUsers = new Set<string>();
  let totalCost = 0;
  let totalTokens = 0;

  for (const row of rows) {
    const model = row.model_id ? modelById.get(row.model_id) : undefined;
    const label = model?.name ?? 'Unknown';
    const provider = model?.provider ?? 'unknown';

    const current = byModel.get(label) ?? { input: 0, output: 0 };
    current.input += row.input_tokens;
    current.output += row.output_tokens;
    byModel.set(label, current);

    byProvider.set(provider, (byProvider.get(provider) ?? 0) + Number(row.estimated_cost));

    if (row.user_id) activeUsers.add(row.user_id);
    totalCost += Number(row.estimated_cost);
    totalTokens += row.input_tokens + row.output_tokens;
  }

  return {
    range,
    truncated: rows.length >= 50_000,
    totals: {
      messages: rows.length,
      tokens: totalTokens,
      cost: totalCost,
      activeUsers: activeUsers.size,
    },
    messagesPerDay: [...perDay.entries()].map(([date, count]) => ({ date: date.slice(5), count })),
    tokensByModel: [...byModel.entries()].map(([name, v]) => ({
      name,
      input: v.input,
      output: v.output,
    })),
    costByProvider: [...byProvider.entries()].map(([name, cost]) => ({
      name,
      cost: Number(cost.toFixed(4)),
    })),
  };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const range: RangeKey =
    params.range && params.range in RANGES ? (params.range as RangeKey) : '30d';

  const data = await loadAnalytics(range);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Aggregated from usage logs. Costs are estimates from the per-model rates.
        </p>
      </header>

      <AnalyticsCharts data={data} />
    </div>
  );
}
