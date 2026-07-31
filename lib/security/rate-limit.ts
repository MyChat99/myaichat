import 'server-only';

import { createAdminClient } from '@/lib/db/admin';

const DEFAULT_MESSAGES_PER_HOUR = 60;

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  used: number;
  retryAfterSeconds: number;
};

async function getHourlyLimit(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', 'rate_limit_messages_per_hour')
    .maybeSingle();

  const value = data?.value;
  return typeof value === 'number' && value > 0 ? value : DEFAULT_MESSAGES_PER_HOUR;
}

/**
 * Per-user hourly cap on chat requests.
 *
 * Counts the user's own messages rather than `usage_logs`, because usage rows
 * are only written after a response completes — counting those would let a
 * burst of concurrent requests all pass the check before any of them lands.
 *
 * Runs through the admin client on purpose: the count must span the user's
 * whole account, and it is invoked only from an already-authenticated route.
 */
export async function checkChatRateLimit(userId: string): Promise<RateLimitResult> {
  const limit = await getHourlyLimit();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();

  const { data: conversations } = await admin
    .from('conversations')
    .select('id')
    .eq('user_id', userId);

  const conversationIds = (conversations ?? []).map((c) => c.id);
  if (conversationIds.length === 0) {
    return { allowed: true, limit, used: 0, retryAfterSeconds: 0 };
  }

  const { count } = await admin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .in('conversation_id', conversationIds)
    .eq('role', 'user')
    .gte('created_at', since);

  const used = count ?? 0;

  return {
    allowed: used < limit,
    limit,
    used,
    // Coarse but honest: the window is rolling, so the worst case is an hour.
    retryAfterSeconds: used < limit ? 0 : 3600,
  };
}
