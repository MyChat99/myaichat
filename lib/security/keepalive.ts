import 'server-only';

import { createAdminClient } from '@/lib/db/admin';

/**
 * Keeping the database awake.
 *
 * A free Supabase project pauses after a period without activity, and a paused
 * project takes the whole application down — not slowly, not with a warning
 * anyone sees, just gone until somebody opens a dashboard. The failure is
 * silent and total, which is why it gets three layers rather than one.
 *
 *   1. an arrival ping, from any page including the signed-out one
 *   2. an admin button, so the state can be checked deliberately
 *   3. a schedule, because if nobody arrives for a week the first two never run
 *
 * Layer three is the only one that actually solves the stated problem; the
 * first two make it observable and cover ordinary use.
 *
 * ## Why the write is throttled and the read is not
 *
 * `/api/ping` is public — it has to be, or an unvisited signed-out site never
 * pings. A public endpoint that writes on every request is an abuse surface, so
 * the write happens at most once per `WRITE_INTERVAL_MS` no matter how many
 * requests arrive, and a short in-process guard drops repeat traffic before it
 * reaches the database at all. Both are global rather than per-caller: the
 * point is to touch the database occasionally, and one touch serves everyone.
 */

/** Supabase pauses free projects after roughly a week of inactivity. */
export const PAUSE_THRESHOLD_DAYS = 7;

/** Warn from here, so there is time to act before anything stops. */
export const WARN_AFTER_DAYS = 4;

/** At most one keep-alive write per this interval, however much traffic there is. */
const WRITE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Repeat requests inside this window never reach the database. */
const MEMORY_GUARD_MS = 60 * 1000;

const SETTING_KEY = 'last_keepalive_at';

/**
 * Process-local, and deliberately not shared between instances.
 *
 * It exists to blunt a flood against one container, not to coordinate — the
 * durable throttle is the stored timestamp, which every instance reads.
 */
let lastSeenInThisProcess = 0;

/**
 * Is a durable write due?
 *
 * Extracted and exported so it can be tested at arbitrary timestamps. It was
 * previously inline, and the test that thought it covered this actually never
 * reached it: the in-process guard short-circuits a second call inside a
 * minute, so removing the throttle entirely still produced a passing run. Two
 * independent limiters need two independent tests.
 */
export function isWriteDue(last: string | null, now: number, force: boolean): boolean {
  if (force || !last) return true;
  return now - Date.parse(last) > WRITE_INTERVAL_MS;
}

export type PingResult = {
  ok: boolean;
  /** True when this call actually wrote, rather than finding a recent enough one. */
  wrote: boolean;
  /** Round trip to the database, in ms. Null when nothing was measured. */
  latencyMs: number | null;
  lastActivityAt: string | null;
  error?: string;
};

export async function readLastActivity(): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db
    .from('system_settings')
    .select('value')
    .eq('key', SETTING_KEY)
    .maybeSingle();
  return typeof data?.value === 'string' ? data.value : null;
}

/**
 * Touch the database.
 *
 * `force` is for the admin button: a deliberate check should always produce a
 * real round trip and a real latency figure, otherwise it reports on a cache
 * and tells the operator nothing.
 */
export async function ping(force = false): Promise<PingResult> {
  const now = Date.now();

  if (!force && now - lastSeenInThisProcess < MEMORY_GUARD_MS) {
    return { ok: true, wrote: false, latencyMs: null, lastActivityAt: null };
  }
  lastSeenInThisProcess = now;

  const db = createAdminClient();
  const startedAt = Date.now();

  try {
    const { data, error } = await db
      .from('system_settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle();

    if (error) throw error;

    const last = typeof data?.value === 'string' ? data.value : null;
    const due = isWriteDue(last, now, force);

    if (!due) {
      // The read alone is a round trip, which is the whole point — the project
      // has been touched. Writing again would add nothing.
      return { ok: true, wrote: false, latencyMs: Date.now() - startedAt, lastActivityAt: last };
    }

    const stamp = new Date(now).toISOString();
    const { error: writeError } = await db
      .from('system_settings')
      .upsert({ key: SETTING_KEY, value: stamp as never }, { onConflict: 'key' });

    if (writeError) throw writeError;

    return { ok: true, wrote: true, latencyMs: Date.now() - startedAt, lastActivityAt: stamp };
  } catch (err) {
    return {
      ok: false,
      wrote: false,
      latencyMs: Date.now() - startedAt,
      lastActivityAt: null,
      // Shown only to an admin. The public route discards it.
      error: err instanceof Error ? err.message : 'unknown error',
    };
  }
}

export type ActivityStatus = {
  lastActivityAt: string | null;
  daysSince: number | null;
  level: 'ok' | 'warn' | 'critical' | 'unknown';
  message: string;
};

export async function activityStatus(): Promise<ActivityStatus> {
  const lastActivityAt = await readLastActivity();

  if (!lastActivityAt) {
    return {
      lastActivityAt: null,
      daysSince: null,
      level: 'unknown',
      message: 'No keep-alive has been recorded yet. It is written on the first visit.',
    };
  }

  const daysSince = (Date.now() - Date.parse(lastActivityAt)) / 86_400_000;
  const rounded = Math.floor(daysSince * 10) / 10;

  if (daysSince >= PAUSE_THRESHOLD_DAYS) {
    return {
      lastActivityAt,
      daysSince: rounded,
      level: 'critical',
      message: `${rounded} days since the last keep-alive. A free project pauses at around ${PAUSE_THRESHOLD_DAYS}.`,
    };
  }
  if (daysSince >= WARN_AFTER_DAYS) {
    return {
      lastActivityAt,
      daysSince: rounded,
      level: 'warn',
      message: `${rounded} days since the last keep-alive. Pausing starts at around ${PAUSE_THRESHOLD_DAYS} days.`,
    };
  }
  return {
    lastActivityAt,
    daysSince: rounded,
    level: 'ok',
    message: `Last touched ${rounded === 0 ? 'today' : `${rounded} days ago`}.`,
  };
}
