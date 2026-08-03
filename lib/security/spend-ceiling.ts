import 'server-only';

import { createAdminClient } from '@/lib/db/admin';

/**
 * The deployment-wide monthly spend ceiling.
 *
 * The per-user daily budget answers "can one person run up a bill". This
 * answers the question that actually keeps an owner awake: **can everybody**.
 * Ten strangers inside their individual budgets are still ten times the bill,
 * and nothing in this app previously counted the total.
 *
 * ## This one fails CLOSED, and that is deliberate
 *
 * Every other limit here treats a missing setting as "unlimited", so that
 * upgrading a deployment never starts refusing requests. That default is wrong
 * for this control. The keys being spent belong to one person, the traffic can
 * come from anyone with the link, and an unset ceiling on a public URL is an
 * open tab on somebody's card. A deployment that has never configured this gets
 * `DEFAULT_CEILING_USD` rather than infinity, and an admin who wants more sets
 * more — a deliberate act, by the person who pays.
 *
 * Setting `0` explicitly still means unlimited. Turning a safety limit off
 * should be possible; it should just require saying so.
 *
 * ## What it is not
 *
 * It is a ceiling, not a meter. Usage rows are written when a response
 * finishes, so requests already in flight when the line is crossed will
 * complete — the same honest caveat the daily budget carries. It stops a
 * runaway; it does not bill to the cent.
 */

/** Applied when nothing is configured. Enough to try the app, not to fund a bot. */
export const DEFAULT_CEILING_USD = 25;

export type CeilingResult = {
  allowed: boolean;
  /** 0 only when an admin has explicitly turned the ceiling off. */
  limitUsd: number;
  spentUsd: number;
  /** Null when unlimited. */
  remainingUsd: number | null;
};

function startOfUtcMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function getMonthlyCeilingUsd(): Promise<number> {
  const db = createAdminClient();
  const { data } = await db
    .from('system_settings')
    .select('value')
    .eq('key', 'monthly_spend_ceiling_usd')
    .maybeSingle();

  // A missing row is not "unlimited" here — see the note above.
  if (data?.value === undefined || data.value === null) return DEFAULT_CEILING_USD;
  const value = Number(data.value);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_CEILING_USD;
  return value;
}

/** Spend across every user this calendar month, in USD. */
export async function monthToDateSpendUsd(): Promise<number> {
  const db = createAdminClient();
  const { data } = await db
    .from('usage_logs')
    .select('estimated_cost')
    .gte('created_at', startOfUtcMonth());

  return Number((data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost), 0).toFixed(6));
}

export async function checkMonthlySpendCeiling(): Promise<CeilingResult> {
  const limitUsd = await getMonthlyCeilingUsd();
  if (limitUsd === 0) {
    return {
      allowed: true,
      limitUsd: 0,
      spentUsd: await monthToDateSpendUsd(),
      remainingUsd: null,
    };
  }

  const spentUsd = await monthToDateSpendUsd();
  return {
    allowed: spentUsd < limitUsd,
    limitUsd,
    spentUsd,
    remainingUsd: Number(Math.max(0, limitUsd - spentUsd).toFixed(6)),
  };
}

/**
 * What a user is told when the deployment has hit its ceiling.
 *
 * Deliberately does not name the figure. The person who hit it is usually not
 * the person who pays, the amount is the owner's business, and "come back
 * later" is the only actionable part for the reader either way.
 */
export const CEILING_MESSAGE =
  'This deployment has reached its monthly spending limit. Ask the administrator to raise it, or try again next month.';
