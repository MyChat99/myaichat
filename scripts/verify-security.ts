/**
 * Proves the Priority-3 hardening actually holds.
 *
 * Everything here asserts STORED STATE or a real return value, never the shape
 * of a response — the RLS recursion bug (ISSUE-007) passed a test that only
 * looked at what came back, because a blocked write and a crashed write look
 * identical from outside.
 *
 * ⚠️ MUTATES SHARED STATE: the token-budget section temporarily writes
 * `system_settings.daily_token_budget_per_user` and restores it in `finally`.
 * There is one Supabase project behind local and production (ISSUE-015), so
 * this is excluded from CI for the same reason `verify:admin` is. If it dies
 * mid-run it prints the value it was restoring so it can be put back by hand.
 *
 *   npm run verify:security
 */
import './_env';

import { createClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/db/admin';
import { isDisposableEmail } from '@/lib/security/disposable-domains';
import {
  containsEmailLocalPart,
  isCommonPassword,
  isLowEntropy,
  signUpPasswordSchema,
} from '@/lib/security/password';
import {
  checkThrottle,
  clearAttemptsFor,
  recordAttempt,
  THROTTLE_LIMITS,
} from '@/lib/security/throttle';
import { checkChatRateLimit } from '@/lib/security/rate-limit';
import { checkDailyTokenBudget } from '@/lib/security/token-budget';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = '') {
  checks++;
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function section(title: string) {
  console.log(`\n${title}\n`);
}

// ------------------------------------------------------------------ passwords

function verifyPasswordRules() {
  section('Signup password rules');

  const rejected = [
    ['too short', 'Sh0rt!pw'],
    ['common word', 'password'],
    ['common word with digits', 'Password123'],
    ['seasonal', 'Summer2024'],
    ['product name', 'myaichat99'],
    ['single repeated character', 'aaaaaaaaaaaa'],
    ['repeated unit', 'abcabcabcabc'],
    ['digits only', '1234567890'],
  ] as const;

  for (const [label, password] of rejected) {
    const result = signUpPasswordSchema.safeParse({ email: 'nobody@example.com', password });
    check(`rejects ${label}`, !result.success, `"${password}" was accepted`);
  }

  const accepted = ['correct-horse-battery', 'Tr0ubad0ur&Anvil', 'the quiet lamp on nine'];
  for (const password of accepted) {
    const result = signUpPasswordSchema.safeParse({ email: 'nobody@example.com', password });
    check(`accepts a real passphrase (${password.length} chars)`, result.success);
  }

  // A long passphrase must NOT be rejected for lacking symbols — that is the
  // whole point of following NIST rather than composition rules.
  check(
    'does not require mixed case, digits or symbols',
    signUpPasswordSchema.safeParse({
      email: 'nobody@example.com',
      password: 'staple mirror window',
    }).success,
  );

  const withEmail = signUpPasswordSchema.safeParse({
    email: 'alice.smith@example.com',
    password: 'alicesmith-x9',
  });
  check('rejects a password containing the email local part', !withEmail.success);

  check(
    'containsEmailLocalPart ignores very short locals',
    !containsEmailLocalPart('bob99x', 'bo@example.com'),
  );
  check('isCommonPassword is case-insensitive', isCommonPassword('QwErTy'));
  check('isLowEntropy catches 3-distinct-character strings', isLowEntropy('ababababab'));
}

// ------------------------------------------------------------- disposable email

function verifyDisposableEmails() {
  section('Disposable email blocklist');

  for (const email of ['a@mailinator.com', 'a@GUERRILLAMAIL.com', 'a@team.mailinator.com']) {
    check(`blocks ${email}`, isDisposableEmail(email));
  }

  for (const email of ['a@gmail.com', 'a+tag@gmail.com', 'a@proton.me', 'a@notmailinator.com']) {
    check(`allows ${email}`, !isDisposableEmail(email));
  }
}

// -------------------------------------------------------------------- throttle

async function verifyThrottle() {
  section('Login throttling');

  // A synthetic identifier — no real account is touched, and the module hashes
  // it before storage anyway.
  const email = `throttle-probe-${process.pid}@example.invalid`;
  const ip = `203.0.113.${process.pid % 254}`;
  const db = createAdminClient();

  try {
    check('a fresh identifier is allowed', (await checkThrottle(email, ip, 'login')).allowed);

    for (let i = 0; i < THROTTLE_LIMITS.maxPerIdentifier; i++) {
      await recordAttempt(email, ip, 'login', false);
    }

    const blocked = await checkThrottle(email, ip, 'login');
    check(`blocked after ${THROTTLE_LIMITS.maxPerIdentifier} failures`, !blocked.allowed);
    check('reports a retry-after within the window', blocked.retryAfterSeconds > 0);

    // Stored state, not just the return value: the rows must actually be there.
    const { count } = await db
      .from('auth_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('kind', 'login');
    check(
      'failures are persisted in auth_attempts',
      (count ?? 0) >= THROTTLE_LIMITS.maxPerIdentifier,
    );

    // The stored identifier must not be the email.
    const { data: rows } = await db.from('auth_attempts').select('identifier').limit(50);
    const leaked = (rows ?? []).some((r) => r.identifier.includes('@'));
    check('identifiers are hashed, not raw emails', !leaked);

    await recordAttempt(email, ip, 'login', true);
    check('a success clears that account', (await checkThrottle(email, ip, 'login')).allowed);

    // The publishable key must see nothing: RLS on with no policies = deny all.
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: visible } = await anon.from('auth_attempts').select('id').limit(1);
    check('auth_attempts is unreadable with the publishable key', (visible ?? []).length === 0);
  } finally {
    // Only this probe's rows. A blanket delete by timestamp would clear real
    // users' recent failures too — quietly disarming the throttle for anyone
    // being attacked while the test ran.
    await clearAttemptsFor(email, ip);
  }
}

// ---------------------------------------------------------------- token budget

async function verifyTokenBudget() {
  section('Daily token budget');

  const db = createAdminClient();
  const KEY = 'daily_token_budget_per_user';

  const { data: original } = await db
    .from('system_settings')
    .select('value')
    .eq('key', KEY)
    .maybeSingle();
  const originalValue = (original?.value as number | undefined) ?? 0;

  // A user id that owns no usage rows, so "used" is a known 0.
  const emptyUser = '00000000-0000-4000-8000-0000000000ff';

  try {
    await db.from('system_settings').upsert({ key: KEY, value: 0 }, { onConflict: 'key' });
    const unlimited = await checkDailyTokenBudget(emptyUser);
    check('0 means unlimited', unlimited.allowed && unlimited.limit === 0);

    await db.from('system_settings').upsert({ key: KEY, value: 1000 }, { onConflict: 'key' });
    const underBudget = await checkDailyTokenBudget(emptyUser);
    check('a user with no usage is under budget', underBudget.allowed && underBudget.used === 0);

    // Find a real user who HAS spent tokens today, and prove the count is real.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data: usage } = await db
      .from('usage_logs')
      .select('user_id, input_tokens, output_tokens')
      .not('user_id', 'is', null)
      .gte('created_at', startOfDay.toISOString())
      .limit(1);

    const spender = usage?.[0];
    if (spender?.user_id) {
      await db.from('system_settings').upsert({ key: KEY, value: 1 }, { onConflict: 'key' });
      const result = await checkDailyTokenBudget(spender.user_id);
      check('a user over the budget is refused', !result.allowed, `used ${result.used}`);
      check('the reported usage is non-zero', result.used > 0);
    } else {
      console.log('  skip  no usage logged today, so the over-budget path is untested');
    }
  } finally {
    await db
      .from('system_settings')
      .upsert({ key: KEY, value: originalValue }, { onConflict: 'key' });
    const { data: restored } = await db
      .from('system_settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle();

    if ((restored?.value as number) !== originalValue) {
      console.error(
        `\n  !!!!  COULD NOT RESTORE ${KEY}. Set it back to ${originalValue} in /admin/settings.`,
      );
      failures++;
    } else {
      console.log(`  ok    ${KEY} restored to ${originalValue}`);
      checks++;
    }
  }
}

// ------------------------------------------------------------------ rate limit

/**
 * The hourly message limit, against a real user with real rows.
 *
 * Counting is asserted separately from the cutoff, because the two fail
 * differently: a miscount is silent (a user gets more or fewer messages than
 * configured), while a broken cutoff is the one that costs money.
 */
async function verifyRateLimit() {
  section('Hourly message rate limit');

  const db = createAdminClient();
  const KEY = 'rate_limit_messages_per_hour';
  const email = `ratelimit-probe-${process.pid}@example.invalid`;

  const { data: original } = await db
    .from('system_settings')
    .select('value')
    .eq('key', KEY)
    .maybeSingle();
  const originalValue = (original?.value as number | undefined) ?? 60;

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password: 'probe-passphrase-9f3a',
    email_confirm: true,
  });

  if (createError || !created?.user) {
    check('could create a probe user', false, createError?.message);
    return;
  }

  const userId = created.user.id;

  try {
    const fresh = await checkChatRateLimit(userId);
    check('a user with no messages is allowed', fresh.allowed && fresh.used === 0);

    const { data: conversation } = await db
      .from('conversations')
      .insert({ user_id: userId, title: 'probe', model_id: null })
      .select('id')
      .single();

    if (!conversation) {
      check('could create a probe conversation', false);
      return;
    }

    const MESSAGES = 3;
    await db.from('messages').insert(
      Array.from({ length: MESSAGES }, (_, i) => ({
        conversation_id: conversation.id,
        role: 'user' as const,
        content: `probe ${i}`,
      })),
    );

    const counted = await checkChatRateLimit(userId);
    check(`counts exactly ${MESSAGES} messages`, counted.used === MESSAGES, `got ${counted.used}`);
    check('still allowed below the limit', counted.allowed);

    // Assistant replies must NOT count against a *message* limit.
    await db.from('messages').insert({
      conversation_id: conversation.id,
      role: 'assistant' as const,
      content: 'probe reply',
    });
    const afterReply = await checkChatRateLimit(userId);
    check(
      'assistant replies are not counted',
      afterReply.used === MESSAGES,
      `got ${afterReply.used}`,
    );

    await db.from('system_settings').upsert({ key: KEY, value: MESSAGES }, { onConflict: 'key' });
    const atLimit = await checkChatRateLimit(userId);
    check('refused once the configured limit is reached', !atLimit.allowed);
    check('reports a retry-after', atLimit.retryAfterSeconds > 0);
  } finally {
    await db
      .from('system_settings')
      .upsert({ key: KEY, value: originalValue }, { onConflict: 'key' });
    const { data: restored } = await db
      .from('system_settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle();

    if ((restored?.value as number) !== originalValue) {
      console.error(`\n  !!!!  COULD NOT RESTORE ${KEY}. Set it back to ${originalValue}.`);
      failures++;
    } else {
      console.log(`  ok    ${KEY} restored to ${originalValue}`);
      checks++;
    }

    // Cascades to the conversation and its messages.
    await db.auth.admin.deleteUser(userId).catch(() => {});
  }
}

async function main() {
  console.log('Security hardening — throttling, password rules, rate limits, token budget');

  verifyPasswordRules();
  verifyDisposableEmails();
  await verifyThrottle();
  await verifyRateLimit();
  await verifyTokenBudget();

  console.log(
    failures === 0
      ? `\nAll ${checks} security checks passed.`
      : `\n${failures} of ${checks} security checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
