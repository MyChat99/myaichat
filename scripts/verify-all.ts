/**
 * Runs every verification suite in a safe order, and proves the database is
 * clean between the ones that mutate it.
 *
 * Resolves ISSUE-015. Two suites — `verify:admin` and `verify:security` —
 * deliberately break shared state and restore it in `finally`: a provider gets
 * disabled, a stored key gets corrupted, a system setting gets changed. Run
 * back-to-back with a suite that reads that state, assertions in one observe
 * the other's mid-flight state, and four failures appear that all pass when the
 * suites run alone.
 *
 * What this adds beyond `for s in …; do npm run $s; done`:
 *
 *  1. **A pre-flight clean check.** If a previous run died before its `finally`,
 *     a provider is still disabled right now — and every subsequent run builds
 *     on that. Detected before anything else runs, with the fix printed.
 *  2. **Ordering.** Read-only suites first, mutating suites last and never
 *     adjacent to a suite that reads what they break.
 *  3. **A clean check between mutating suites**, so the blame lands on the suite
 *     that actually leaked rather than the next one to notice.
 *  4. **A final clean check**, so a leak is reported by the run that caused it.
 *
 * ⚠️ Still does NOT make it safe to run against production while people are
 * using it. Serialising removes the interference; it does not remove the
 * seconds during which a provider really is disabled. The remaining fix is a
 * separate Supabase project for tests, which is infrastructure, not code.
 *
 *   npm run verify:all
 *   npm run verify:all -- --offline    (only the suites needing no server)
 */
import './_env';

import { spawnSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

import { SECRET_KEY, SUPABASE_URL } from './_env';

const OFFLINE = process.argv.includes('--offline');

type Suite = {
  script: string;
  /** What it needs to be present. */
  needs: 'nothing' | 'database' | 'server';
  /** True when it breaks shared state and restores it in `finally`. */
  mutates?: boolean;
};

/**
 * Order matters and is not alphabetical.
 *
 * Cheap and credential-free first, so a typo fails in two seconds rather than
 * after four minutes of database work. Mutating suites last, so everything that
 * reads shared state has already run against a known-clean database.
 */
const SUITES: Suite[] = [
  { script: 'verify:authz', needs: 'nothing' },
  { script: 'verify:degradation', needs: 'nothing' },
  { script: 'verify:resilience', needs: 'nothing' },
  { script: 'verify:logging', needs: 'nothing' },
  { script: 'verify:csv', needs: 'nothing' },
  { script: 'verify:bundle', needs: 'nothing' },
  { script: 'verify:headers', needs: 'nothing' },
  { script: 'verify:attachments', needs: 'nothing' },
  { script: 'verify:theme', needs: 'nothing' },
  { script: 'verify:riso', needs: 'nothing' },
  { script: 'verify:email', needs: 'nothing' },

  { script: 'verify:schema', needs: 'database' },
  { script: 'verify:seed', needs: 'database' },
  { script: 'verify:rls', needs: 'database' },
  { script: 'verify:session', needs: 'database' },

  { script: 'verify:gates', needs: 'server' },
  { script: 'verify:appearance', needs: 'server' },
  { script: 'verify:api', needs: 'server' },
  { script: 'verify:storage', needs: 'server' },
  { script: 'verify:chat', needs: 'server' },
  { script: 'verify:providers', needs: 'server' },

  // ── mutating, last, in this order ──
  // security changes a system setting; admin breaks a provider key. Nothing
  // after them reads what they touch.
  { script: 'verify:security', needs: 'database', mutates: true },
  { script: 'verify:admin', needs: 'server', mutates: true },
];

const db = createClient(SUPABASE_URL(), SECRET_KEY(), { auth: { persistSession: false } });

type Dirt = { what: string; fix: string };

/**
 * Is the shared state a suite could have left broken actually intact?
 *
 * Checks the specific things the mutating suites touch — not "does the database
 * look fine", which is unfalsifiable.
 */
async function findDirt(): Promise<Dirt[]> {
  const dirt: Dirt[] = [];

  const { data: providers } = await db.from('providers').select('name, enabled, encrypted_api_key');

  for (const provider of providers ?? []) {
    if (!provider.enabled) {
      dirt.push({
        what: `provider "${provider.name}" is DISABLED`,
        fix: `enable it in /admin/providers — a verify:admin run probably died before restoring it`,
      });
    }
    // verify:admin corrupts a key to prove chat fails without it. A key that no
    // longer parses is the fingerprint of that suite dying mid-flight.
    if (provider.encrypted_api_key && !provider.encrypted_api_key.startsWith('v1.')) {
      dirt.push({
        what: `provider "${provider.name}" has a CORRUPTED key`,
        fix: `re-enter the key in /admin/providers, or run npm run keys:encrypt`,
      });
    }
  }

  const { data: settings } = await db.from('system_settings').select('key, value');
  const setting = (key: string) => settings?.find((s) => s.key === key)?.value;

  // verify:security temporarily sets these to tiny values.
  const rateLimit = setting('rate_limit_messages_per_hour');
  if (typeof rateLimit === 'number' && rateLimit < 10) {
    dirt.push({
      what: `rate_limit_messages_per_hour is ${rateLimit} — implausibly low`,
      fix: 'set it back in /admin/settings (60 is the seeded default)',
    });
  }

  const budget = setting('daily_token_budget_per_user');
  if (typeof budget === 'number' && budget > 0 && budget < 100) {
    dirt.push({
      what: `daily_token_budget_per_user is ${budget} — implausibly low`,
      fix: 'set it back in /admin/settings (0 = unlimited is the seeded default)',
    });
  }

  return dirt;
}

function reportDirt(stage: string, dirt: Dirt[]) {
  console.error(`\n  ✖ SHARED STATE IS DIRTY (${stage})\n`);
  for (const d of dirt) {
    console.error(`    · ${d.what}`);
    console.error(`      fix: ${d.fix}`);
  }
  console.error('');
}

function run(script: string): { ok: boolean; ms: number } {
  const started = Date.now();
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit', shell: false });
  return { ok: result.status === 0, ms: Date.now() - started };
}

async function main() {
  console.log(`Verification suite — all${OFFLINE ? ' (offline only)' : ''}\n`);

  const selected = OFFLINE ? SUITES.filter((s) => s.needs === 'nothing') : SUITES;

  if (!OFFLINE) {
    // Before anything. A dirty start is not this run's fault, and running
    // anyway would produce failures that look like new bugs.
    const dirt = await findDirt();
    if (dirt.length > 0) {
      reportDirt('before starting', dirt);
      console.error('  Nothing was run. Fix the above, then try again.\n');
      process.exit(1);
    }
    console.log('  ok  shared state is clean before starting\n');
  }

  const results: { script: string; ok: boolean; ms: number }[] = [];
  let leaked: string | null = null;

  for (const suite of selected) {
    console.log(`\n${'─'.repeat(64)}\n▶ ${suite.script}\n`);
    const { ok, ms } = run(suite.script);
    results.push({ script: suite.script, ok, ms });

    // Check immediately after each mutating suite, so the blame lands on the
    // suite that leaked rather than on the next one to trip over it.
    if (suite.mutates && !OFFLINE) {
      const dirt = await findDirt();
      if (dirt.length > 0) {
        reportDirt(`after ${suite.script}`, dirt);
        leaked = suite.script;
        break;
      }
      console.log(`\n  ok  ${suite.script} restored shared state`);
    }
  }

  console.log(`\n${'═'.repeat(64)}\nSummary\n`);

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    const seconds = (r.ms / 1000).toFixed(1).padStart(6);
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${seconds}s  ${r.script}`);
  }

  const total = (results.reduce((sum, r) => sum + r.ms, 0) / 1000).toFixed(1);
  console.log(`\n  ${results.length} suite(s) in ${total}s`);

  if (leaked) {
    console.error(`\n  ✖ ${leaked} did not restore shared state. Fix that before anything else.`);
    process.exit(1);
  }

  if (failed.length > 0) {
    console.error(
      `\n  ✖ ${failed.length} suite(s) failed: ${failed.map((f) => f.script).join(', ')}`,
    );
    process.exit(1);
  }

  console.log('\n  ✔ everything passed, and shared state is as it started.\n');
  process.exit(0);
}

void main();
