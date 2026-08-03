/**
 * Cost transparency — what an answer cost, and who is allowed to see it.
 *
 * The number on screen is only worth showing if it is the number that was
 * actually charged. So this asserts stored state, not response shape: that a
 * completed turn links its usage row to the answer it paid for, that the link
 * survives the answer being deleted, that a conversation's total is the sum of
 * its own rows and nobody else's, and that another user cannot read it.
 *
 * The last two checks open a browser, because every assertion below can pass
 * while the price is invisible on screen — which is exactly what happened the
 * first time this feature was run: the element existed and was not visible.
 *
 *   npm run dev
 *   npm run verify:costs
 */
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'costs-test-password-1234';

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

async function makeUser(tag: string) {
  const email = `costs-${tag}-${process.pid}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  const value = `base64-${Buffer.from(JSON.stringify(signIn!.session)).toString('base64')}`;
  return { id: data.user.id, cookieValue: value, cookie: `sb-${projectRef}-auth-token=${value}` };
}

/** Runs one real turn through the chat route and returns the `done` event. */
async function turn(cookie: string, conversationId: string, message: string) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ conversationId, message }),
  });
  const text = await response.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((event) => event.type === 'done');
}

async function main() {
  const { data: model } = await admin
    .from('models')
    .select('id, providers!inner(key_last4)')
    .eq('enabled', true)
    .not('providers.key_last4', 'is', null)
    .limit(1)
    .maybeSingle();

  if (!model) {
    console.log('\n  skip  no model with a configured key; nothing can be priced.\n');
    process.exit(0);
  }

  const owner = await makeUser('owner');
  const stranger = await makeUser('stranger');

  try {
    console.log('The link between an answer and what it cost\n');

    const { data: convo } = await admin
      .from('conversations')
      .insert({ user_id: owner.id, title: 'Costs', model_id: model.id })
      .select('id')
      .single();

    const done = await turn(owner.cookie, convo!.id, 'Reply with exactly: OK');
    check('a turn completes', typeof done?.messageId === 'string', JSON.stringify(done));

    check(
      'the completion reports what it cost, so the answer is priced before any reload',
      typeof done?.costUsd === 'number' && (done.costUsd as number) > 0,
      String(done?.costUsd),
    );

    const { data: usage } = await admin
      .from('usage_logs')
      .select('id, message_id, estimated_cost')
      .eq('user_id', owner.id);

    check(
      'the usage row is linked to the answer it paid for',
      (usage ?? []).length === 1 && usage![0].message_id === done?.messageId,
      JSON.stringify(usage),
    );

    check(
      'and the stored cost matches what the user was told',
      Number(usage![0].estimated_cost) === done?.costUsd,
      `${usage![0].estimated_cost} vs ${done?.costUsd}`,
    );

    const { loadConversationCost, loadMonthToDateSpend } = await import('../lib/db/costs');

    const cost = await loadConversationCost(convo!.id, owner.id);
    check(
      'the conversation total is the sum of its rows',
      cost.totalUsd === Number(usage![0].estimated_cost),
      `${cost.totalUsd} vs ${usage![0].estimated_cost}`,
    );
    check(
      'and the answer carries its own price',
      cost.byMessage.get(String(done!.messageId))?.costUsd === done?.costUsd,
    );

    console.log('\nWhose money it is\n');

    /**
     * The check that matters most.
     *
     * `usage_logs` is service-role only, so this loader runs with a client that
     * bypasses RLS. The ownership scope is therefore the entire boundary — if it
     * were dropped, any signed-in user could price any conversation by id.
     */
    const stolen = await loadConversationCost(convo!.id, stranger.id);
    check(
      'another user reading this conversation by id gets nothing',
      stolen.totalUsd === 0 && stolen.byMessage.size === 0,
      `${stolen.totalUsd} / ${stolen.byMessage.size} messages`,
    );

    const strangerMonth = await loadMonthToDateSpend(stranger.id);
    check(
      "and a stranger's month-to-date does not include this spend",
      strangerMonth === 0,
      String(strangerMonth),
    );

    const ownerMonth = await loadMonthToDateSpend(owner.id);
    check(
      'the owner sees their own spend',
      ownerMonth >= Number(usage![0].estimated_cost),
      String(ownerMonth),
    );

    console.log('\nWhat happens to the record when the answer goes\n');

    /**
     * Deleting a conversation must not erase what it cost. The link is
     * `on delete set null` rather than cascade for exactly this reason: billing
     * history that a user can delete is not billing history.
     */
    const spendBefore = await loadMonthToDateSpend(owner.id);
    await admin.from('messages').delete().eq('id', String(done!.messageId));

    const { data: after } = await admin
      .from('usage_logs')
      .select('id, message_id')
      .eq('id', usage![0].id)
      .maybeSingle();

    check('deleting the answer does not delete the usage row', after !== null, 'row disappeared');
    check(
      'the link is cleared rather than the record',
      after?.message_id === null,
      String(after?.message_id),
    );
    check(
      'so month-to-date spend is unchanged',
      (await loadMonthToDateSpend(owner.id)) === spendBefore,
      `${spendBefore} → ${await loadMonthToDateSpend(owner.id)}`,
    );

    const orphaned = await loadConversationCost(convo!.id, owner.id);
    check(
      'an answer that can no longer be priced is counted, not guessed at',
      orphaned.byMessage.size === 0,
      `${orphaned.byMessage.size} priced`,
    );

    console.log('\nWhat it would have cost elsewhere\n');

    const { compareCost, describeRatio, ESTIMATE_CAVEAT } =
      await import('../lib/theme/compare-cost');
    const { loadPricedModels } = await import('../lib/db/costs');

    const priced = [
      {
        id: 'a',
        displayName: 'Cheap',
        providerName: 'x',
        inputCostPer1k: 0.001,
        outputCostPer1k: 0.002,
      },
      {
        id: 'b',
        displayName: 'Dear',
        providerName: 'y',
        inputCostPer1k: 0.01,
        outputCostPer1k: 0.02,
      },
      {
        id: 'c',
        displayName: 'Unpriced',
        providerName: 'z',
        inputCostPer1k: null,
        outputCostPer1k: null,
      },
    ];
    const compared = compareCost(1000, 1000, priced, 'a');

    check(
      'the comparison is arithmetic on the tokens, not a new request',
      compared.find((r) => r.modelId === 'b')?.usd === 0.03,
      String(compared.find((r) => r.modelId === 'b')?.usd),
    );
    check(
      'the model that answered is marked as such',
      compared.find((r) => r.actual)?.modelId === 'a',
    );
    check(
      'a dearer model is described as dearer, in multiples',
      describeRatio(compared.find((r) => r.modelId === 'b')?.ratio ?? null) === '10× more',
      String(describeRatio(compared.find((r) => r.modelId === 'b')?.ratio ?? null)),
    );

    /**
     * The case that matters most in this feature. A model with no price set
     * must read as "no price set" and never as $0.00 — free is the one number
     * here that would be actively harmful to invent, and it sorts last because
     * a missing price is a gap in the admin's setup, not a bargain.
     */
    const unpriced = compared.find((r) => r.modelId === 'c');
    check('a model with no price data reports null, not zero', unpriced?.usd === null);
    check('and it carries no ratio', unpriced?.ratio === null);
    check(
      'and it sorts last, so it cannot be mistaken for the cheapest',
      compared[compared.length - 1].modelId === 'c',
    );
    check('the cheapest priced model sorts first', compared[0].modelId === 'a');
    check('and the estimate says out loud that it is one', /tokenise/i.test(ESTIMATE_CAVEAT));

    console.log('\nA provider disabled mid-conversation\n');

    /**
     * Built rather than borrowed: disabling a real provider would mutate state
     * every other suite depends on. A throwaway provider proves the same thing
     * and is deleted in the same block.
     */
    const providerInsert = await admin
      .from('providers')
      .insert({ name: `test-provider-${process.pid}`, enabled: true, key_last4: '9999' })
      .select('id')
      .single();
    if (providerInsert.error || !providerInsert.data) {
      check(
        'a throwaway provider can be created for this check',
        false,
        providerInsert.error?.message ?? 'no row returned',
      );
    }
    const tempProvider = providerInsert.data;
    const { data: tempModel } = tempProvider
      ? await admin
          .from('models')
          .insert({
            provider_id: tempProvider.id,
            model_id: 'priceless-model',
            display_name: 'Priceless (test)',
            max_tokens: 256,
            enabled: true,
            // Prices deliberately omitted, so the row lands on the schema
            // default — which is exactly how a model nobody priced looks.
          })
          .select('id')
          .single()
      : { data: null };

    try {
      if (!tempProvider || !tempModel) throw new Error('setup failed');
      const withProvider = await loadPricedModels();
      const found = withProvider.find((m) => m.id === tempModel!.id);
      check('an enabled provider’s model is offered for comparison', Boolean(found));
      check(
        'a model nobody priced arrives as 0 and 0, the schema default',
        found?.inputCostPer1k === 0 && found?.outputCostPer1k === 0,
        JSON.stringify({ in: found?.inputCostPer1k, out: found?.outputCostPer1k }),
      );
      check(
        'and is reported as unpriced, never as the cheapest option at $0.0000',
        compareCost(1000, 1000, [priced[0], found!], 'a').find((r) => r.modelId === found!.id)
          ?.usd === null,
      );

      await admin.from('providers').update({ enabled: false }).eq('id', tempProvider!.id);
      const afterDisable = await loadPricedModels();
      check(
        'disabling the provider drops its model from the comparison',
        !afterDisable.some((m) => m.id === tempModel!.id),
      );
    } finally {
      if (tempModel) await admin.from('models').delete().eq('id', tempModel.id);
      if (tempProvider) await admin.from('providers').delete().eq('id', tempProvider.id);
    }

    console.log('\nOn screen\n');

    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addCookies([
        {
          name: `sb-${projectRef}-auth-token`,
          value: owner.cookieValue,
          domain: new URL(BASE_URL).hostname,
          path: '/',
        },
      ]);
      const page = await context.newPage();

      // A fresh conversation, because the one above had its answer deleted.
      const { data: shown } = await admin
        .from('conversations')
        .insert({ user_id: owner.id, title: 'Costs on screen', model_id: model.id })
        .select('id')
        .single();
      await turn(owner.cookie, shown!.id, 'Reply with exactly: OK');

      await page.goto(`${BASE_URL}/c/${shown!.id}`, { waitUntil: 'networkidle' });

      const stamp = page.locator('[data-press="answer-cost"]').first();
      const ledger = page.locator('[data-press="ledger"]').first();

      /**
       * `isVisible`, not `count`. The first browser run of this feature timed
       * out waiting for a *visible* stamp while the element was present in the
       * DOM — a price nobody can see is not cost transparency.
       */
      check('the answer shows what it cost', await stamp.isVisible());
      check(
        'and it reads as money, not as a token count',
        /^\$\d/.test((await stamp.textContent())?.trim() ?? ''),
        (await stamp.textContent())?.trim(),
      );
      check('the running total is on screen', await ledger.isVisible());
      check(
        'and it names both this conversation and the month',
        /this month/i.test((await ledger.textContent()) ?? ''),
        (await ledger.textContent())?.trim(),
      );

      /**
       * An answer written before this feature existed has no usage row. It must
       * render no price at all — a confident $0.00 on an answer that cost real
       * money is worse than saying nothing.
       */
      const { data: legacy } = await admin
        .from('conversations')
        .insert({ user_id: owner.id, title: 'Before the ledger', model_id: model.id })
        .select('id')
        .single();
      await admin.from('messages').insert([
        { conversation_id: legacy!.id, role: 'user', content: 'old question' },
        { conversation_id: legacy!.id, role: 'assistant', content: 'old answer' },
      ]);

      await page.goto(`${BASE_URL}/c/${legacy!.id}`, { waitUntil: 'networkidle' });
      check(
        'an unpriced older answer shows no price rather than $0.00',
        (await page.locator('[data-press="answer-cost"]').count()) === 0,
      );
      check(
        'and the page still renders the answer',
        (await page.getByText('old answer').count()) > 0,
      );
    } finally {
      await browser.close();
    }
  } finally {
    await admin.auth.admin.deleteUser(owner.id).catch(() => {});
    await admin.auth.admin.deleteUser(stranger.id).catch(() => {});
    console.log('\nTest users cleaned up.');
  }

  console.log(failures === 0 ? '\nAll cost checks passed.' : `\n${failures} cost check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-costs crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
