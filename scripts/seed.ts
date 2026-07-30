/**
 * Seeds the first admin user and default system settings.
 *
 * Idempotent — safe to re-run. Requires SEED_ADMIN_EMAIL and
 * SEED_ADMIN_PASSWORD in .env.local.
 *
 *   npm run seed
 */
import { createClient } from '@supabase/supabase-js';

import { SECRET_KEY, SUPABASE_URL, required } from './_env';
import type { Database } from '../lib/db/types';

const admin = createClient<Database>(SUPABASE_URL(), SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULT_SETTINGS: {
  key: string;
  value: Database['public']['Tables']['system_settings']['Row']['value'];
}[] = [
  { key: 'default_model_id', value: null },
  { key: 'global_system_prompt', value: '' },
  { key: 'rate_limit_messages_per_hour', value: 60 },
  { key: 'max_upload_size_mb', value: 20 },
  { key: 'signups_enabled', value: true },
];

async function findUserByEmail(email: string) {
  // listUsers is paginated; the admin account is created first so page 1 is enough
  // for seeding, but scan a few pages to stay correct on a populated project.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  const email = required('SEED_ADMIN_EMAIL');
  const password = required('SEED_ADMIN_PASSWORD');

  let user = await findUserByEmail(email);

  if (user) {
    console.log(`  ok    admin user already exists (${email})`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // skip the confirmation email for the seeded account
      user_metadata: { display_name: 'Admin' },
    });
    if (error) throw error;
    user = data.user;
    console.log(`  ok    created admin user (${email})`);
  }

  // The handle_new_user trigger inserts the profile with role 'user';
  // promoting here is the only path to admin, and it needs the secret key.
  const { error: roleError } = await admin
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', user.id);
  if (roleError) throw roleError;
  console.log('  ok    profile promoted to admin');

  const { error: settingsError } = await admin
    .from('system_settings')
    .upsert(DEFAULT_SETTINGS, { onConflict: 'key' });
  if (settingsError) throw settingsError;
  console.log(`  ok    ${DEFAULT_SETTINGS.length} system settings upserted`);

  console.log('\nSeed complete.');
}

main().catch((err: unknown) => {
  console.error('\nSeed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
