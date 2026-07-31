/**
 * Security audit — dependencies, secret leaks, and RLS coverage.
 *
 * Runs in CI as a NON-BLOCKING job. The dependency tree carries known
 * transitive advisories that cannot be cleared without downgrading Next itself
 * (ISSUE-006); failing the build on them would block every PR permanently and
 * teach everyone to ignore the check, which is worse than an advisory that
 * people actually read.
 *
 * The RLS section needs database credentials and is skipped without them, so
 * the whole script still runs in a credential-free CI job.
 *
 *   npm run security:audit
 */
import { execFileSync } from 'node:child_process';

// Loads .env.local when present. Without this the RLS section skipped itself on
// a developer machine that HAD credentials — a check that quietly does nothing
// locally and is expected to do nothing in CI is a check that never runs.
import './_env';

let findings = 0;
let warnings = 0;

function fail(message: string, detail = '') {
  console.error(`  FAIL  ${message}${detail ? `\n        ${detail}` : ''}`);
  findings++;
}

function warn(message: string, detail = '') {
  console.warn(`  warn  ${message}${detail ? `\n        ${detail}` : ''}`);
  warnings++;
}

function ok(message: string) {
  console.log(`  ok    ${message}`);
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).toString();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- secrets

/**
 * Patterns for credentials that must never be committed.
 *
 * Deliberately matches the SHAPE of a live key, not the word "key" — the goal
 * is catching a real secret pasted into a file, not flagging every variable
 * name. `.env.example` is excluded because placeholders live there by design.
 */
const SECRET_PATTERNS: { name: string; pattern: string }[] = [
  { name: 'Anthropic API key', pattern: 'sk-ant-[a-zA-Z0-9-]{20,}' },
  { name: 'OpenAI API key', pattern: 'sk-proj-[a-zA-Z0-9_-]{20,}' },
  { name: 'OpenAI legacy key', pattern: 'sk-[a-zA-Z0-9]{32,}' },
  { name: 'Supabase secret key', pattern: 'sb_secret_[a-zA-Z0-9_-]{10,}' },
  { name: 'Resend API key', pattern: 're_[a-zA-Z0-9]{20,}' },
  { name: 'AWS/R2 access key id', pattern: 'AKIA[0-9A-Z]{16}' },
  { name: 'Private key block', pattern: 'BEGIN (RSA |EC )?PRIVATE KEY' },
  {
    name: 'Base64 32-byte master key assignment',
    pattern: 'ENCRYPTION_MASTER_KEY=[A-Za-z0-9+/]{40,}',
  },
];

function scanForSecrets() {
  console.log('\nCommitted secrets\n');

  for (const { name, pattern } of SECRET_PATTERNS) {
    // Tracked files only: .env.local is gitignored, and scanning the working
    // tree would flag the developer's own legitimate local secrets.
    const hits = git(['grep', '-lIE', pattern, '--', '.', ':(exclude).env.example'])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      // This file necessarily contains the patterns it searches for.
      .filter((f) => f !== 'scripts/security-audit.ts');

    if (hits.length > 0) fail(`${name} appears in tracked files`, hits.join(', '));
  }

  const envTracked = git(['ls-files', '.env', '.env.local', '.env.production']).trim();
  if (envTracked) fail('an env file is tracked by git', envTracked);
  else ok('no env files are tracked');

  if (findings === 0) ok('no credential-shaped strings in tracked files');
}

// ---------------------------------------------------------------- deps

function auditDependencies() {
  console.log('\nDependencies\n');

  try {
    const raw = execFileSync('npm', ['audit', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    report(raw);
  } catch (err) {
    // npm audit exits non-zero when advisories exist; the JSON is still on
    // stdout, so this is the normal path rather than an error.
    const raw = (err as { stdout?: Buffer }).stdout?.toString() ?? '';
    if (raw) report(raw);
    else warn('npm audit produced no output');
  }

  function report(raw: string) {
    try {
      const parsed = JSON.parse(raw) as {
        metadata?: { vulnerabilities?: Record<string, number> };
      };
      const counts = parsed.metadata?.vulnerabilities ?? {};
      const critical = counts.critical ?? 0;
      const high = counts.high ?? 0;

      if (critical > 0) warn(`${critical} critical advisories`);
      if (high > 0) warn(`${high} high advisories (see ISSUE-006 — mostly dev-only transitives)`);
      if (critical === 0 && high === 0) ok('no critical or high advisories');

      console.log(
        `        totals: ${Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
      );
    } catch {
      warn('could not parse npm audit output');
    }
  }
}

// ---------------------------------------------------------------- RLS

/**
 * Every table in `public` must have row-level security ENABLED.
 *
 * Queried from the pg catalog rather than inferred from the migrations: a
 * migration that forgot `enable row level security` would still look right in
 * the file, and this is the only check that sees the actual database state.
 */
async function auditRls() {
  console.log('\nRow-level security\n');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secret) {
    console.log('  skip  no database credentials in the environment (expected in CI)');
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, secret, { auth: { persistSession: false } });

  // Reads the pg catalog through a SECURITY DEFINER function (migration
  // 20260731120001) — the only way to see real database state rather than
  // trusting that every migration remembered `enable row level security`.
  const { data, error } = await db.rpc('rls_status');

  if (error) {
    warn('could not read RLS status', `${error.message} — is migration 20260731120001 applied?`);
    return;
  }

  const rows = (data ?? []) as { table_name: string; rls_enabled: boolean; policy_count: number }[];

  if (rows.length === 0) {
    warn('rls_status() returned no tables');
    return;
  }

  // Tables that are meant to have zero policies: RLS on with nothing granted is
  // deny-all, which is exactly right for state only the service role may touch.
  // Anything NOT on this list with no policies is almost certainly an oversight.
  const INTENTIONALLY_DENY_ALL = new Set(['auth_attempts']);

  for (const row of rows) {
    if (!row.rls_enabled) {
      fail(`table "${row.table_name}" has RLS DISABLED`);
    } else if (INTENTIONALLY_DENY_ALL.has(row.table_name)) {
      ok(`table "${row.table_name}" is deny-all by design (service role only)`);
    } else if (Number(row.policy_count) === 0) {
      // RLS on with no policies denies everything, which is safe but almost
      // certainly a mistake — the table becomes unreadable to the app.
      warn(`table "${row.table_name}" has RLS enabled but NO policies (denies all access)`);
    }
  }

  const protectedCount = rows.filter((r) => r.rls_enabled).length;
  if (protectedCount === rows.length) {
    ok(`all ${rows.length} public tables have RLS enabled`);
  }
}

async function main() {
  console.log('Security audit');

  scanForSecrets();
  auditDependencies();
  await auditRls();

  console.log(
    `\n${findings} finding(s), ${warnings} warning(s).` +
      (findings > 0 ? ' Findings are blocking.' : ''),
  );

  // Warnings never fail: this job is advisory in CI by design.
  process.exit(findings > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('\nsecurity-audit crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
