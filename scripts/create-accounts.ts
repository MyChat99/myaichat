/**
 * Pre-create N accounts with known passwords.
 *
 * For handing out access when self-service sign-up is closed — which is the
 * intended posture for a deployment funded by one person's provider keys.
 * Accounts are created through the admin API, so they bypass the sign-up policy
 * entirely: closing sign-ups does not stop you making accounts, it stops
 * strangers making them.
 *
 *   npm run accounts:create -- --count=10
 *   npm run accounts:create -- --count=5 --prefix=workshop --domain=example.com
 *   npm run accounts:create -- --count=3 --dry-run
 *
 * ## Two things it will not do
 *
 * It will not create an admin, and it will not reuse a password. Roles are
 * changed deliberately from the admin panel, where the change is audit-logged;
 * a bulk script that can mint admins is a much worse thing to leave lying
 * around than one that cannot. Each account gets its own generated passphrase
 * from `crypto.randomBytes`, so one leaked credential is one account.
 *
 * ## Where the passwords go
 *
 * To stdout, once, and nowhere else. Not to a file, because a file of live
 * credentials outlives the moment somebody needed it, and not to the database,
 * which stores only the hash. Copy them when they are printed or run it again
 * with different names.
 */
import { randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import type { Database } from '../lib/db/types';
import { SECRET_KEY, SUPABASE_URL } from './_env';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const has = (name: string) => process.argv.includes(`--${name}`);

const COUNT = Number(arg('count', '5'));
const PREFIX = arg('prefix', 'user');
const DOMAIN = arg('domain', 'example.com');
const DRY_RUN = has('dry-run');

const admin = createClient<Database>(SUPABASE_URL(), SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Four short words plus digits: long enough to satisfy the sign-up rules and
 * the length that actually matters, short enough to read down a phone line.
 */
const WORDS = [
  'press',
  'ink',
  'paper',
  'plate',
  'folio',
  'quire',
  'signature',
  'proof',
  'galley',
  'stone',
  'roller',
  'type',
  'margin',
  'gutter',
  'rule',
  'stock',
];

function passphrase(): string {
  const pick = () => WORDS[randomBytes(1)[0] % WORDS.length];
  const digits = String(randomBytes(2).readUInt16BE(0) % 10_000).padStart(4, '0');
  return `${pick()}-${pick()}-${pick()}-${digits}`;
}

async function main() {
  if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 200) {
    console.error('--count must be a whole number between 1 and 200.');
    process.exit(1);
  }

  console.log(
    `${DRY_RUN ? 'Would create' : 'Creating'} ${COUNT} account(s) as ${PREFIX}N@${DOMAIN}\n`,
  );

  const made: { email: string; password: string }[] = [];
  const failed: { email: string; reason: string }[] = [];

  for (let i = 1; i <= COUNT; i++) {
    const email = `${PREFIX}${i}@${DOMAIN}`;
    const password = passphrase();

    if (DRY_RUN) {
      made.push({ email, password: '(not created)' });
      continue;
    }

    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      // Confirmed on creation: these accounts are handed out directly, and an
      // unconfirmed account cannot sign in.
      email_confirm: true,
    });

    if (error) failed.push({ email, reason: error.message });
    else made.push({ email, password });
  }

  console.log('  EMAIL'.padEnd(40) + 'PASSWORD');
  console.log('  ' + '─'.repeat(38) + '─'.repeat(28));
  for (const a of made) console.log(`  ${a.email.padEnd(38)}${a.password}`);

  if (failed.length) {
    console.log('\n  Not created:');
    for (const f of failed) console.log(`  ${f.email.padEnd(38)}${f.reason}`);
  }

  console.log(
    DRY_RUN
      ? `\n${made.length} would be created. Nothing was written — drop --dry-run to create them.`
      : `\n${made.length} created, ${failed.length} failed. These passwords are shown once and stored nowhere.`,
  );
  if (!DRY_RUN && made.length) {
    console.log(
      'Every account is role `user`. Promote from /admin/users, where it is audit-logged.',
    );
  }
}

main().catch((err: unknown) => {
  console.error('create-accounts crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
