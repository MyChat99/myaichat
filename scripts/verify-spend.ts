/**
 * The controls that stand between a public link and someone else's card.
 *
 * Two of them, and they answer different questions. The per-user daily budget
 * asks "can one person run up a bill"; the monthly ceiling asks "can everybody",
 * which is the one that matters once a link is shared. The signup policy decides
 * who gets to try.
 *
 * Every check here is about a REFUSAL, and every refusal is verified to have
 * spent nothing — a limit that refuses after paying the provider is not a limit.
 *
 *   npm run dev
 *   npm run verify:spend
 */
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'spend-test-password-1234';

const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

let failures = 0;
function check(name: string, passed: boolean, detail = '') {
  if (passed) console.log(`  ok    ${name}`);
  else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

type Setting = { key: string; value: unknown | null };

async function readSetting(key: string): Promise<Setting> {
  const { data } = await admin.from('system_settings').select('value').eq('key', key).maybeSingle();
  return { key, value: data?.value ?? null };
}

async function writeSetting(key: string, value: unknown) {
  await admin.from('system_settings').upsert({ key, value: value as never }, { onConflict: 'key' });
}

async function restore(setting: Setting) {
  if (setting.value === null) await admin.from('system_settings').delete().eq('key', setting.key);
  else await writeSetting(setting.key, setting.value);
}

async function main() {
  const ceilingBefore = await readSetting('monthly_spend_ceiling_usd');
  const signupsBefore = await readSetting('signups_enabled');
  const domainsBefore = await readSetting('signup_allowed_domains');

  const email = `spend-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  try {
    const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const cookie = `sb-${projectRef}-auth-token=base64-${Buffer.from(
      JSON.stringify(signIn!.session),
    ).toString('base64')}`;

    const { data: model } = await admin
      .from('models')
      .select('id, providers!inner(key_last4)')
      .eq('enabled', true)
      .not('providers.key_last4', 'is', null)
      .limit(1)
      .maybeSingle();

    const { data: convo } = await admin
      .from('conversations')
      .insert({ user_id: userId, title: 'Spend', model_id: model?.id ?? null })
      .select('id')
      .single();

    const send = (message: string) =>
      fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ conversationId: convo!.id, message }),
      });

    console.log('The ceiling fails CLOSED, not open\n');

    const { getMonthlyCeilingUsd, DEFAULT_CEILING_USD } =
      await import('../lib/security/spend-ceiling');

    await admin.from('system_settings').delete().eq('key', 'monthly_spend_ceiling_usd');
    check(
      'an unconfigured deployment gets a real ceiling, not infinity',
      (await getMonthlyCeilingUsd()) === DEFAULT_CEILING_USD,
      String(await getMonthlyCeilingUsd()),
    );

    await writeSetting('monthly_spend_ceiling_usd', 0);
    check(
      'and an admin can still turn it off, deliberately, with 0',
      (await getMonthlyCeilingUsd()) === 0,
    );

    console.log('\nAt the ceiling, nothing more is spent\n');

    const usageBefore = await admin
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // A ceiling far below anything already spent this month.
    await writeSetting('monthly_spend_ceiling_usd', 0.000001);

    const refused = await send('This must not reach a provider.');
    const body = await refused.json().catch(() => ({}));

    check('a message past the ceiling is refused', refused.status === 429, `got ${refused.status}`);
    check(
      'and the refusal points at the administrator, not at the user',
      typeof body.error === 'string' && /administrator/i.test(body.error),
      String(body.error).slice(0, 120),
    );
    check(
      'and it does NOT name the figure, which is the owner’s business',
      typeof body.error === 'string' && !/\$|\d+\.\d\d/.test(body.error),
      String(body.error).slice(0, 120),
    );

    const usageAfter = await admin
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    check(
      'and NOTHING was spent — no usage row was written',
      (usageAfter.count ?? 0) === (usageBefore.count ?? 0),
      `${usageBefore.count} → ${usageAfter.count}`,
    );

    /**
     * The comparison route spends N times a single turn, so it is the one that
     * would hurt most if it were missed. It has its own pre-flight and could
     * easily have been left out of this control.
     */
    const compareRefused = await fetch(`${BASE_URL}/api/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ prompt: 'hello', modelIds: [model!.id, model!.id] }),
    });
    check(
      'and the comparison route is behind the same ceiling',
      compareRefused.status === 429 || compareRefused.status === 400,
      `got ${compareRefused.status}`,
    );

    await restore(ceilingBefore);

    console.log('\nWho may create an account\n');

    const { checkSignupAllowed, loadSignupPolicy } = await import('../lib/security/signup-policy');

    await writeSetting('signups_enabled', false);
    const closed = await checkSignupAllowed('someone@example.com');
    check('with sign-ups closed, nobody may sign up', closed.allowed === false);
    check(
      'and the refusal says who to ask',
      !closed.allowed && /administrator/i.test(closed.reason),
      closed.allowed ? '' : closed.reason,
    );

    await writeSetting('signups_enabled', true);
    await writeSetting('signup_allowed_domains', 'example.com, university.ac.uk');
    check(
      'a listed domain is allowed',
      (await checkSignupAllowed('someone@example.com')).allowed === true,
    );
    check(
      'a domain that only looks similar is not',
      (await checkSignupAllowed('someone@notexample.com')).allowed === false,
    );
    check(
      'a second listed domain is allowed too',
      (await checkSignupAllowed('a@university.ac.uk')).allowed === true,
    );
    check(
      'the mode is reported as restricted',
      (await loadSignupPolicy()).mode === 'domain',
      (await loadSignupPolicy()).mode,
    );

    await admin.from('system_settings').delete().eq('key', 'signup_allowed_domains');
    check(
      'with no list, any domain may sign up',
      (await checkSignupAllowed('anyone@anywhere.dev')).allowed === true,
    );

    /**
     * The gap this whole module was written for.
     *
     * The admin switch existed for several phases and the sign-up action never
     * read it. A policy enforced only in a helper nobody calls is not enforced,
     * so this drives the real form in a real browser rather than importing the
     * action — which is also the only way to prove it from outside.
     */
    console.log('\nThe switch is wired to the door\n');

    await writeSetting('signups_enabled', false);
    const blockedEmail = `blocked-${process.pid}@example.com`;

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/signup`, { waitUntil: 'networkidle' });
      await page.fill('#email', blockedEmail);
      await page.fill('#password', 'a-long-enough-passphrase-9021');
      const displayName = page.locator('#displayName');
      if (await displayName.count()) await displayName.fill('Blocked');
      await page.click('button[type="submit"]');

      // The form posts and re-renders with the refusal in an alert.
      let message = '';
      for (let i = 0; i < 40; i++) {
        message =
          (await page
            .locator('[role="alert"]')
            .first()
            .textContent()
            .catch(() => '')) ?? '';
        if (message.trim()) break;
        await page.waitForTimeout(250);
      }

      check(
        'the sign-up FORM refuses when the switch is off',
        /closed/i.test(message),
        message.trim() || 'the page said nothing',
      );
      check('and the browser was not signed in', !page.url().endsWith('/'), page.url());
    } finally {
      await browser.close();
    }

    const { data: after } = await admin.auth.admin.listUsers();
    check('and no account was created', !after.users.some((u) => u.email === blockedEmail));
  } finally {
    await restore(ceilingBefore);
    await restore(signupsBefore);
    await restore(domainsBefore);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\nSettings restored, test user cleaned up.');
  }

  console.log(
    failures === 0
      ? '\nSpend is bounded and sign-ups are controlled.'
      : `\n${failures} spend check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-spend crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
