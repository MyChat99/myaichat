import 'server-only';

import { createAdminClient } from '@/lib/db/admin';
import type { PricedModel } from '@/lib/theme/compare-cost';

/**
 * What a conversation and each of its answers actually cost.
 *
 * The numbers are read from `usage_logs`, never recomputed from today's model
 * rates: a price change should not silently rewrite what last month's answers
 * cost. The row stores the cost as it was at the time, which is the only
 * version of the number that stays true.
 *
 * Read through the ADMIN client on purpose. `usage_logs` is one of the
 * service-role-only tables — a user cannot select their own rows directly, by
 * design — so ownership is enforced here instead, by scoping every query to a
 * user id the caller has already authenticated.
 */

export type MessageCost = {
  messageId: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

export type ConversationCost = {
  /** Per assistant message. Absent for messages generated before the link existed. */
  byMessage: Map<string, MessageCost>;
  totalUsd: number;
  /** How many answers in this conversation predate the link and cannot be priced. */
  unpricedMessages: number;
};

export async function loadConversationCost(
  conversationId: string,
  userId: string,
): Promise<ConversationCost> {
  const db = createAdminClient();

  // Ownership first, then the join. A conversation id alone must never be
  // enough to read what someone else spent.
  const { data: conversation } = await db
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!conversation) {
    return { byMessage: new Map(), totalUsd: 0, unpricedMessages: 0 };
  }

  const { data: messages } = await db
    .from('messages')
    .select('id, role')
    .eq('conversation_id', conversationId);

  const assistantIds = (messages ?? []).filter((m) => m.role === 'assistant').map((m) => m.id);

  if (assistantIds.length === 0) {
    return { byMessage: new Map(), totalUsd: 0, unpricedMessages: 0 };
  }

  const { data: usage } = await db
    .from('usage_logs')
    .select('message_id, estimated_cost, input_tokens, output_tokens')
    .in('message_id', assistantIds);

  const byMessage = new Map<string, MessageCost>();
  let totalUsd = 0;

  for (const row of usage ?? []) {
    if (!row.message_id) continue;
    const cost = Number(row.estimated_cost);
    byMessage.set(row.message_id, {
      messageId: row.message_id,
      costUsd: cost,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
    });
    totalUsd += cost;
  }

  return {
    byMessage,
    totalUsd: Number(totalUsd.toFixed(6)),
    unpricedMessages: assistantIds.length - byMessage.size,
  };
}

/** The user's own spend since UTC midnight on the first of this month. */
export async function loadMonthToDateSpend(userId: string): Promise<number> {
  const db = createAdminClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data } = await db
    .from('usage_logs')
    .select('estimated_cost')
    .eq('user_id', userId)
    .gte('created_at', monthStart);

  return Number((data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost), 0).toFixed(6));
}

export { formatUsd } from '@/lib/theme/money';

/**
 * Every model a user could have picked, with its prices — nulls preserved.
 *
 * Deliberately NOT read through the registry, which coerces prices with
 * `Number(...)`: `Number(null)` is 0, and a model with no price set would show
 * as free, which is the one number in this feature that must never be invented.
 *
 * Scoped to providers that hold a key and are enabled, so the comparison lists
 * models the deployment could actually have used rather than every row in the
 * catalogue.
 */
export async function loadPricedModels(): Promise<PricedModel[]> {
  const db = createAdminClient();
  const { data } = await db
    .from('models')
    .select(
      'id, display_name, input_cost_per_1k, output_cost_per_1k, providers!inner(name, enabled, key_last4)',
    )
    .eq('enabled', true)
    .eq('providers.enabled', true)
    .not('providers.key_last4', 'is', null)
    .order('display_name');

  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    providerName: row.providers.name,
    inputCostPer1k: row.input_cost_per_1k === null ? null : Number(row.input_cost_per_1k),
    outputCostPer1k: row.output_cost_per_1k === null ? null : Number(row.output_cost_per_1k),
  }));
}
