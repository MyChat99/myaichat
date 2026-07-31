/**
 * Confirms every Phase 1 table/view exists and is reachable through PostgREST.
 *
 * Uses the secret key directly rather than lib/db/admin.ts, because that module
 * is marked `server-only` and cannot be imported outside the Next.js runtime.
 *
 *   npx tsx scripts/verify-schema.ts
 */
import { createClient } from '@supabase/supabase-js';

import { SECRET_KEY, SUPABASE_URL } from './_env';
import type { Database } from '../lib/db/types';

const admin = createClient<Database>(SUPABASE_URL(), SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Tables and views are listed separately: supabase-js overloads `from()` per
// relation kind, so a single union of both would not type-check.
const TABLES = [
  'profiles',
  'providers',
  'models',
  'conversations',
  'messages',
  'user_preferences',
  'usage_logs',
  'audit_logs',
  'system_settings',
] as const;

const VIEWS = ['providers_public'] as const;

async function main() {
  let failed = 0;

  const counts = [
    ...TABLES.map((t) => [t, admin.from(t).select('*', { count: 'exact', head: true })] as const),
    ...VIEWS.map((v) => [v, admin.from(v).select('*', { count: 'exact', head: true })] as const),
  ];

  for (const [rel, query] of counts) {
    const { count, error } = await query;

    if (error) {
      console.error(`  FAIL  ${rel.padEnd(18)} ${error.message}`);
      failed++;
    } else {
      console.log(`  ok    ${rel.padEnd(18)} ${count ?? 0} rows`);
    }
  }

  // is_admin() should exist and return false for a random uuid.
  const { data, error } = await admin.rpc('is_admin', {
    uid: '00000000-0000-0000-0000-000000000000',
  });
  if (error) {
    console.error(`  FAIL  is_admin()         ${error.message}`);
    failed++;
  } else {
    console.log(`  ok    is_admin()         returned ${data}`);
  }

  // ─────────────────────────────────────────────── index coverage
  //
  // Indexes are the easiest thing to lose in a migration rewrite, and losing
  // one produces no error — only a query that gets slower as the table grows,
  // which nobody notices until it is already slow.
  console.log('\nIndex coverage\n');

  {
    const { data: plans, error: planError } = await admin.rpc('explain_analytics');

    if (planError) {
      console.error(`  FAIL  explain_analytics() is callable — ${planError.message}`);
      failed++;
    } else {
      const rows = (plans ?? []) as { label: string; plan: string }[];
      const assert = (label: string, ok: boolean, detail = '') => {
        if (ok) console.log(`  ok    ${label}`);
        else {
          console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
          failed++;
        }
      };

      assert('explain_analytics() returns plans', rows.length >= 6, `${rows.length}`);

      /**
       * The dashboard counts user messages globally by date. Before
       * `messages_user_created_at_idx` the planner had nothing to use and
       * costed this at 13.61; with the index it costs 5.71.
       *
       * Asserted on the COST, not the runtime. At ~180 rows the runtime is
       * 0.05ms either way — a timing assertion here would pass whether or not
       * the index existed, which is the definition of a useless test. The cost
       * estimate is what actually changes, because it is what the planner
       * computes from the index's existence.
       */
      const messagesToday = rows.find((r) => r.label.includes('messages today'));
      const cost = Number(messagesToday?.plan.match(/cost=[\d.]+\.\.([\d.]+)/)?.[1] ?? 0);
      assert(
        'the user-message count has an index to use',
        cost > 0 && cost < 10,
        `planner cost ${cost} — without messages_user_created_at_idx it is ~13.6`,
      );

      // Nothing in this set should be reading the whole of usage_logs when a
      // date filter is present.
      const analytics = rows.find((r) => r.label.includes('usage over 30 days'));
      assert(
        'the 30-day analytics query is bounded by a limit',
        (analytics?.plan ?? '').startsWith('Limit'),
        (analytics?.plan ?? '').slice(0, 60),
      );
    }
  }

  console.log(failed === 0 ? '\nSchema verified.' : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
