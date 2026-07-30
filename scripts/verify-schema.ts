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

  console.log(failed === 0 ? '\nSchema verified.' : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
