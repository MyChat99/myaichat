/**
 * Confirms the seed produced exactly one admin and the expected settings.
 * Guards against duplicate-admin regressions in the seed script.
 *
 *   npm run verify:seed
 */
import { createClient } from '@supabase/supabase-js';

import { SECRET_KEY, SUPABASE_URL, required } from './_env';
import type { Database } from '../lib/db/types';

const admin = createClient<Database>(SUPABASE_URL(), SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EXPECTED_SETTINGS = [
  'daily_token_budget_per_user',
  'global_system_prompt',
  'rate_limit_messages_per_hour',
  'max_upload_size_mb',
  'signups_enabled',
];

let failed = 0;

function check(name: string, passed: boolean, detail = '') {
  if (passed) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function main() {
  const email = required('SEED_ADMIN_EMAIL').trim().toLowerCase();

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw listErr;

  const matches = list.users.filter((u) => u.email?.toLowerCase() === email);
  check(
    'exactly one auth user for the seed email',
    matches.length === 1,
    `found ${matches.length}`,
  );

  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', matches[0]?.id ?? '')
    .single();
  check('seeded profile has the admin role', profile?.role === 'admin', `role="${profile?.role}"`);

  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
  check('exactly one admin profile exists', admins?.length === 1, `found ${admins?.length}`);

  const { data: settings } = await admin.from('system_settings').select('key, value');
  const keys = (settings ?? []).map((s) => s.key).sort();
  check(
    'system settings match the expected set',
    JSON.stringify(keys) === JSON.stringify([...EXPECTED_SETTINGS].sort()),
    `got ${JSON.stringify(keys)}`,
  );

  const nullValued = (settings ?? []).filter((s) => s.value === null);
  check('no setting has a null value', nullValued.length === 0);

  // Explicitly absent until Phase 3 creates a model worth pointing at.
  check('default_model_id is not seeded', !keys.includes('default_model_id'));

  console.log(failed === 0 ? '\nSeed verified.' : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nverify-seed crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
