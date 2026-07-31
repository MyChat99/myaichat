import 'server-only';

import { createAdminClient } from '@/lib/db/admin';

/**
 * Per-endpoint rate limiting for everything that is not chat.
 *
 * Chat has its own limiter (`lib/security/rate-limit.ts`) because it counts
 * *messages* — a domain concept an administrator configures in
 * `system_settings`. These are different: they bound how hard a client may hit
 * a particular endpoint, and the right number is a property of the endpoint,
 * not of the product. Mixing them would mean one setting controlling both, and
 * the sensible value for "messages an hour" is nowhere near the sensible value
 * for "presigned URLs a minute".
 *
 * ## Why upload endpoints need their own limits
 *
 * **Presign** mints a credential. Each call produces a URL that can write to
 * the bucket for five minutes. Unbounded, a client can harvest thousands of
 * them and upload far past any per-request size check — the size limit is
 * enforced *per URL*, so the only thing bounding total bytes is how many URLs
 * you can get.
 *
 * **Download** is cheaper but not free: each call signs a URL and, through R2,
 * bills egress. It previously had no limit at all, because the old approach
 * counted `audit_logs` rows and downloads are not audited.
 *
 * Two windows per endpoint, deliberately. A single hourly cap permits a burst
 * that empties the whole budget in three seconds; a single per-minute cap
 * permits that burst every minute all day. Together they bound both shapes.
 */

export type EndpointLimit = {
  perMinute: number;
  perHour: number;
};

export const ENDPOINT_LIMITS: Record<string, EndpointLimit> = {
  // Each one is a writable credential. Tight on purpose.
  'uploads.presign': { perMinute: 20, perHour: 120 },
  // Reads are cheaper, and a gallery view legitimately fetches many at once.
  'uploads.download': { perMinute: 60, perHour: 600 },
  'conversations.export': { perMinute: 10, perHour: 60 },
  // Reads up to 10k audit rows and resolves every actor. Rare by nature.
  'admin.audit_export': { perMinute: 5, perHour: 30 },
};

export type EndpointVerdict = {
  allowed: boolean;
  /** Which window tripped, for the message and the retry-after. */
  window: 'minute' | 'hour' | null;
  limit: number;
  used: number;
  retryAfterSeconds: number;
};

const ALLOWED: EndpointVerdict = {
  allowed: true,
  window: null,
  limit: 0,
  used: 0,
  retryAfterSeconds: 0,
};

/**
 * Checks BOTH windows, then records the attempt.
 *
 * Recorded before the work rather than after, so a request that fails
 * downstream still counts. The alternative rewards failure: a client that makes
 * a thousand requests which all error would be charged for none of them, which
 * is precisely the shape of an abusive client.
 */
export async function checkEndpointLimit(
  userId: string,
  endpoint: keyof typeof ENDPOINT_LIMITS | string,
): Promise<EndpointVerdict> {
  const limit = ENDPOINT_LIMITS[endpoint];
  // An endpoint with no configured limit is not silently unlimited by accident;
  // it is unlimited because nobody added it, which is visible in the table above.
  if (!limit) return ALLOWED;

  const db = createAdminClient();
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();

  // One query for the hour window; the minute window is a filter over the same
  // rows, which is cheaper than a second round trip.
  const { data } = await db
    .from('api_usage')
    .select('created_at')
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
    .gte('created_at', hourAgo)
    .order('created_at', { ascending: true });

  const rows = data ?? [];
  const minuteAgo = now - 60 * 1000;
  const inMinute = rows.filter((r) => new Date(r.created_at).getTime() >= minuteAgo);

  if (inMinute.length >= limit.perMinute) {
    const oldest = new Date(inMinute[0]!.created_at).getTime();
    return {
      allowed: false,
      window: 'minute',
      limit: limit.perMinute,
      used: inMinute.length,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000)),
    };
  }

  if (rows.length >= limit.perHour) {
    const oldest = new Date(rows[0]!.created_at).getTime();
    return {
      allowed: false,
      window: 'hour',
      limit: limit.perHour,
      used: rows.length,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + 3_600_000 - now) / 1000)),
    };
  }

  await db.from('api_usage').insert({ user_id: userId, endpoint });

  // Housekeeping on a sampled basis — this is a hot path, and pruning on every
  // request would double its cost to delete nothing most of the time.
  if (rows.length === 0) await db.rpc('prune_api_usage').then(undefined, () => {});

  return { ...ALLOWED, used: rows.length + 1 };
}

/** Message for a refused request. Says which window, and when to come back. */
export function limitMessage(verdict: EndpointVerdict): string {
  const unit = verdict.window === 'minute' ? 'minute' : 'hour';
  return `Too many requests — the limit is ${verdict.limit} per ${unit}. Try again in ${
    verdict.retryAfterSeconds < 60
      ? `${verdict.retryAfterSeconds} seconds`
      : `${Math.ceil(verdict.retryAfterSeconds / 60)} minutes`
  }.`;
}

/** Exported so tests assert the shipped numbers rather than re-typing them. */
export function limitFor(endpoint: string): EndpointLimit | undefined {
  return ENDPOINT_LIMITS[endpoint];
}
