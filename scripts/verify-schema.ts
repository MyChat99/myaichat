/**
 * Confirms every Phase 1 table/view exists and is reachable through PostgREST.
 *
 * Uses the secret key directly rather than lib/db/admin.ts, because that module
 * is marked `server-only` and cannot be imported outside the Next.js runtime.
 *
 *   npx tsx scripts/verify-schema.ts
 */
import { readFileSync } from 'node:fs';

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

/**
 * The column names in one relation's `Row` type, read from the source text.
 *
 * Reading the source rather than the type is the only option — types are erased
 * before anything runs, so there is nothing left to introspect at runtime. It
 * scans from the relation's `Row:` to the brace that closes it, taking
 * identifiers in property position, and expands the `Timestamps &` intersection
 * the file uses to avoid repeating created_at/updated_at nine times.
 */
function declaredColumns(source: string, relation: string): Set<string> | null {
  const at = source.indexOf(`      ${relation}: {`);
  if (at === -1) return null;

  const rowAt = source.indexOf('Row:', at);
  if (rowAt === -1) return null;

  const open = source.indexOf('{', rowAt);
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;

  const columns = new Set<string>();
  if (source.slice(rowAt, open).includes('Timestamps')) {
    columns.add('created_at');
    columns.add('updated_at');
  }
  for (const line of source.slice(open + 1, close).split('\n')) {
    const match = /^\s{10}([a-z_][a-z0-9_]*)\??:/.exec(line);
    if (match) columns.add(match[1]);
  }
  return columns.size > 0 ? columns : null;
}

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

  // ──────────────────────────────────────── column-level drift
  //
  // `lib/db/types.ts` is hand-written, because `supabase gen types` runs its
  // introspection in a container and there is no Docker here (ISSUE-005). The
  // `--db-url` workaround that fixed `db push` does NOT fix this: the CLI
  // connects to the database and then still demands a container runtime.
  //
  // The existing checks above prove every relation EXISTS. They say nothing
  // about its columns, which is where drift actually happens — a migration adds
  // a column, the hand-written type does not, and every query touching it is
  // silently untyped until something breaks at runtime. That has already
  // happened once here (ISSUE-013).
  //
  // The source of truth is PostgREST's own OpenAPI document. It is derived from
  // the live database, needs no container and no new migration, and is exactly
  // the schema the client library actually talks to — so a column missing from
  // it is a column our code genuinely cannot reach.
  console.log('\nColumn parity with lib/db/types.ts\n');

  {
    const spec = await fetch(`${SUPABASE_URL()}/rest/v1/`, {
      headers: { apikey: SECRET_KEY(), Authorization: `Bearer ${SECRET_KEY()}` },
    })
      .then(
        (r) =>
          r.json() as Promise<{
            definitions?: Record<string, { properties?: Record<string, unknown> }>;
          }>,
      )
      .catch(() => null);

    if (!spec?.definitions) {
      console.error('  FAIL  PostgREST schema document could not be read');
      failed++;
    } else {
      const source = readFileSync(new URL('../lib/db/types.ts', import.meta.url), 'utf8');

      for (const rel of [...TABLES, ...VIEWS]) {
        const live = Object.keys(spec.definitions[rel]?.properties ?? {});
        if (live.length === 0) {
          console.error(`  FAIL  ${rel.padEnd(18)} not present in the PostgREST schema`);
          failed++;
          continue;
        }

        const declared = declaredColumns(source, rel);
        if (declared === null) {
          console.error(`  FAIL  ${rel.padEnd(18)} no Row block found in lib/db/types.ts`);
          failed++;
          continue;
        }

        const missing = live.filter((c) => !declared.has(c));
        const extra = [...declared].filter((c) => !live.includes(c));

        if (missing.length === 0 && extra.length === 0) {
          console.log(`  ok    ${rel.padEnd(18)} ${live.length} columns match`);
        } else {
          // Reported separately because they are different bugs. A column the
          // database has and the types do not is invisible to our code; a
          // column the types have and the database does not is a query that
          // will fail at runtime while type-checking perfectly.
          if (missing.length) {
            console.error(
              `  FAIL  ${rel.padEnd(18)} in the database, absent from types.ts: ${missing.join(', ')}`,
            );
            failed++;
          }
          if (extra.length) {
            console.error(
              `  FAIL  ${rel.padEnd(18)} in types.ts, absent from the database: ${extra.join(', ')}`,
            );
            failed++;
          }
        }
      }
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
       * Asserted on the SHAPE of the plan, not on a cost number.
       *
       * This check used to read the planner's cost estimate and require it to
       * be under 10 — 5.71 with `messages_user_created_at_idx`, 13.61 without.
       * The trouble is that cost scales with table size, so the same query
       * costed 6.89 on a quiet database and 10.76 while test rows were in
       * flight. The check failed for a reason that had nothing to do with the
       * index it was named after, and would have gone on failing harder as real
       * data arrived. A threshold that decays into a false alarm gets ignored,
       * and then it is not a check.
       *
       * The plan tree says whether the index was used, in as many words. That
       * is the actual question, and it does not move with row count. It is
       * readable only because `explain_analytics()` now returns the whole plan
       * as JSON — with `format text` and `execute ... into`, every plan was
       * truncated to its top line and the node naming the index never arrived.
       */
      type PlanNode = { 'Node Type': string; 'Index Name'?: string; Plans?: PlanNode[] };
      const nodes = (plan: string | undefined): PlanNode[] => {
        if (!plan) return [];
        try {
          const flatten = (n: PlanNode): PlanNode[] => [n, ...(n.Plans ?? []).flatMap(flatten)];
          return flatten((JSON.parse(plan) as { Plan: PlanNode }[])[0].Plan);
        } catch {
          // A plan that will not parse is a failure, not an empty result — the
          // assertions below all read "found nothing", which is correct.
          return [];
        }
      };
      const describe = (plan: string | undefined) =>
        nodes(plan)
          .map((n) => n['Node Type'] + (n['Index Name'] ? ` using ${n['Index Name']}` : ''))
          .join(' -> ') || '(no plan)';

      const messagesToday = rows.find((r) => r.label.includes('messages today'))?.plan;
      assert(
        'the user-message count is served by messages_user_created_at_idx',
        nodes(messagesToday).some(
          (n) =>
            /Index (Only )?Scan/.test(n['Node Type']) &&
            n['Index Name'] === 'messages_user_created_at_idx',
        ),
        describe(messagesToday),
      );

      const analytics = rows.find((r) => r.label.includes('usage over 30 days'))?.plan;
      assert(
        'the 30-day analytics query is bounded by a limit',
        nodes(analytics).some((n) => n['Node Type'] === 'Limit'),
        describe(analytics),
      );

      /**
       * Generalised, because the two checks above name two queries and the set
       * has six. A sequential scan on any of these tables is the failure mode
       * the whole index suite exists to prevent, and it is silent — it only
       * shows up as a page that got slower some time after the data grew.
       */
      for (const row of rows) {
        assert(
          `${row.label}: no sequential scan`,
          !nodes(row.plan).some((n) => n['Node Type'] === 'Seq Scan'),
          describe(row.plan),
        );
      }
    }
  }

  console.log(failed === 0 ? '\nSchema verified.' : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
