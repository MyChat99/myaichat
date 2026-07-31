import 'server-only';

import { createAdminClient } from '@/lib/db/admin';
import { getAdapter, registeredProviderNames } from '@/lib/providers/registry';
import { ProviderError } from '@/lib/providers/types';

/**
 * The numbers behind `/admin`.
 *
 * Everything is aggregated in SQL-shaped queries with explicit bounds. The
 * temptation on a page like this is `select *` and count in JavaScript, which
 * works beautifully on the forty rows a new deployment has and collapses at
 * fifty thousand.
 */

export type ProviderHealth = {
  name: string;
  /** null while never checked, or when no key is configured. */
  ok: boolean | null;
  message: string;
  latencyMs: number | null;
  checkedAt: string | null;
};

export type DashboardStats = {
  users: { total: number; admins: number; suspended: number };
  today: { messages: number; tokens: number; costUsd: number; activeUsers: number };
  month: { messages: number; costUsd: number };
  providers: ProviderHealth[];
};

/**
 * Provider health cache.
 *
 * `validateKey()` performs a REAL generation — that is deliberate, because a
 * key with no credit lists models perfectly happily and only fails when asked
 * to write something (ISSUE-012). It also means every check costs money and
 * latency, so calling it on each dashboard render would bill the account for
 * looking at a page.
 *
 * Cached in module scope rather than a table. The tradeoff, stated plainly: it
 * resets on deploy and is per-instance, so a multi-instance deployment checks
 * once per instance. That is acceptable because a check is a handful of tokens
 * — fractions of a cent — and the alternative is a migration, a types entry and
 * a fourth deny-all table for data that is worthless five minutes after it is
 * written. If checks ever become expensive, persist it.
 */
const HEALTH_TTL_MS = 5 * 60_000;
const healthCache = new Map<string, ProviderHealth>();

function isFresh(entry: ProviderHealth | undefined): entry is ProviderHealth {
  if (!entry?.checkedAt) return false;
  return Date.now() - new Date(entry.checkedAt).getTime() < HEALTH_TTL_MS;
}

/**
 * Health for every registered provider.
 *
 * Checks run concurrently — three providers checked in series would make an
 * admin wait for the sum of three network round trips to see a page that is
 * mostly numbers.
 *
 * A failure here is a *result*, never a thrown error: the dashboard's job is to
 * report that a provider is down, and a page that itself 500s because a
 * provider is down reports nothing.
 */
export async function getProviderHealth(force = false): Promise<ProviderHealth[]> {
  const names = registeredProviderNames();

  return Promise.all(
    names.map(async (name): Promise<ProviderHealth> => {
      const cached = healthCache.get(name);
      if (!force && isFresh(cached)) return cached;

      try {
        const adapter = await getAdapter(name);
        const started = Date.now();
        const result = await adapter.validateKey();

        const health: ProviderHealth = {
          name,
          ok: result.valid,
          message: result.valid ? 'Responding' : (result.reason ?? 'Rejected'),
          latencyMs: result.latencyMs ?? Date.now() - started,
          checkedAt: new Date().toISOString(),
        };
        healthCache.set(name, health);
        return health;
      } catch (err) {
        const health: ProviderHealth = {
          name,
          ok: false,
          // A ProviderError message is already written for a human and carries
          // no key material. Anything else is replaced rather than surfaced.
          message: err instanceof ProviderError ? err.message : 'Not configured',
          latencyMs: null,
          checkedAt: new Date().toISOString(),
        };
        healthCache.set(name, health);
        return health;
      }
    }),
  );
}

function startOfUtcDay(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function thirtyDaysAgo(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = createAdminClient();
  const dayStart = startOfUtcDay();
  const monthStart = thirtyDaysAgo();

  // `head: true` with an exact count returns the number without the rows —
  // the difference between a count and a download.
  const [
    profiles,
    admins,
    suspended,
    todayUsage,
    monthUsage,
    todayMessages,
    monthMessages,
    health,
  ] = await Promise.all([
    db.from('profiles').select('*', { count: 'exact', head: true }),
    db.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'admin'),
    db.from('profiles').select('*', { count: 'exact', head: true }).eq('suspended', true),
    db
      .from('usage_logs')
      .select('user_id, input_tokens, output_tokens, estimated_cost')
      .gte('created_at', dayStart),
    db.from('usage_logs').select('estimated_cost').gte('created_at', monthStart),
    db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'user')
      .gte('created_at', dayStart),
    db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'user')
      .gte('created_at', monthStart),
    getProviderHealth(),
  ]);

  const todayRows = todayUsage.data ?? [];

  return {
    users: {
      total: profiles.count ?? 0,
      admins: admins.count ?? 0,
      suspended: suspended.count ?? 0,
    },
    today: {
      messages: todayMessages.count ?? 0,
      tokens: todayRows.reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0),
      costUsd: todayRows.reduce((sum, r) => sum + Number(r.estimated_cost), 0),
      // Distinct users, not rows — one person sending forty messages is one
      // active user, and counting rows would make a single heavy user look
      // like a busy day.
      activeUsers: new Set(todayRows.map((r) => r.user_id).filter(Boolean)).size,
    },
    month: {
      messages: monthMessages.count ?? 0,
      costUsd: (monthUsage.data ?? []).reduce((sum, r) => sum + Number(r.estimated_cost), 0),
    },
    providers: health,
  };
}
