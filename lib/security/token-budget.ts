import 'server-only';

import { createAdminClient } from '@/lib/db/admin';

/**
 * Per-user daily token budget.
 *
 * The hourly message rate limit caps how *often* someone can ask; this caps how
 * much they can spend. They are not interchangeable — sixty messages an hour of
 * 100k-token context is a bill the message counter never sees.
 *
 * Setting: `system_settings.daily_token_budget_per_user`, an integer number of
 * tokens. `0` or a missing row means unlimited, which is the default so that
 * upgrading an existing deployment does not suddenly start refusing requests.
 *
 * Counted from `usage_logs` since UTC midnight. Two consequences worth being
 * honest about:
 *
 *  - Usage rows are written when a response *finishes*, so a burst of parallel
 *    requests can each see the same pre-burst total and all be admitted. The
 *    hourly message limit is what bounds that burst; this is a spend ceiling,
 *    not a semaphore. Making it exact would need a reservation row per request
 *    and a compensating delete on failure — real complexity for a limit whose
 *    job is to stop a runaway, not to bill to the token.
 *  - The day boundary is UTC for everyone, not the user's local midnight. A
 *    per-user timezone would make "today" ambiguous in the admin dashboard,
 *    which reads the same rows.
 */

export type BudgetResult = {
  allowed: boolean;
  /** 0 means no budget is configured. */
  limit: number;
  used: number;
};

const ALLOWED_UNLIMITED: BudgetResult = { allowed: true, limit: 0, used: 0 };

export async function getDailyTokenBudget(): Promise<number> {
  const db = createAdminClient();
  const { data } = await db
    .from('system_settings')
    .select('value')
    .eq('key', 'daily_token_budget_per_user')
    .maybeSingle();

  const value = data?.value;
  return typeof value === 'number' && value > 0 ? Math.floor(value) : 0;
}

function startOfUtcDay(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export async function checkDailyTokenBudget(userId: string): Promise<BudgetResult> {
  const limit = await getDailyTokenBudget();
  if (limit === 0) return ALLOWED_UNLIMITED;

  const db = createAdminClient();
  const { data } = await db
    .from('usage_logs')
    .select('input_tokens, output_tokens')
    .eq('user_id', userId)
    .gte('created_at', startOfUtcDay());

  const used = (data ?? []).reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);

  return { allowed: used < limit, limit, used };
}
