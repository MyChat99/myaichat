/**
 * Ask the presses — the contract, including the paths that must refuse.
 *
 * The happy path is the easy half. What this is really for: proving a
 * comparison refuses BEFORE spending when it would blow the daily budget, that
 * one provider failing costs the user only that column, and that usage is
 * recorded per model so the budget and the analytics cannot be bypassed by
 * running spend through this route instead of a conversation.
 *
 *   npm run dev
 *   npm run verify:compare
 */
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'compare-test-password-1234';

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

type Event = Record<string, unknown>;

/** Reads the NDJSON stream to completion and returns every event. */
async function readStream(response: Response): Promise<Event[]> {
  const events: Event[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) events.push(JSON.parse(line) as Event);
    }
  }
  return events;
}

async function main() {
  const email = `compare-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  const cookie = `sb-${projectRef}-auth-token=base64-${Buffer.from(
    JSON.stringify(signIn!.session),
  ).toString('base64')}`;

  const post = (body: unknown, withCookie = true) =>
    fetch(`${BASE_URL}/api/compare`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withCookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });

  let bogusModelId: string | null = null;

  try {
    const { listAvailableModels } = await import('../lib/providers/registry');
    const models = await listAvailableModels();

    if (models.length < 2) {
      console.log('\n  skip  fewer than two models are configured; nothing to compare.\n');
      process.exit(0);
    }

    const [a, b] = models;

    console.log('Refusals\n');

    check(
      'unauthenticated is rejected',
      (await post({ prompt: 'hi', modelIds: [a.id, b.id] }, false)).status === 401,
    );
    check('one model is refused', (await post({ prompt: 'hi', modelIds: [a.id] })).status === 400);
    check(
      'more than four models is refused',
      (await post({ prompt: 'hi', modelIds: [a.id, b.id, a.id, b.id, a.id] })).status === 400,
    );
    check(
      'an empty prompt is refused',
      (await post({ prompt: '   ', modelIds: [a.id, b.id] })).status === 400,
    );
    check(
      'an unknown model is refused with 409, not silently dropped',
      (
        await post({
          prompt: 'hi',
          modelIds: [a.id, '00000000-0000-0000-0000-000000000000'],
        })
      ).status === 409,
    );

    console.log('\nSpend is refused before it happens\n');

    /**
     * The check that matters most.
     *
     * A comparison spends N times a single turn. The ordinary budget check asks
     * "has this user already exceeded the limit"; that is not the same question
     * as "would running four models take them past it". Without the second, a
     * comparison starts inside the budget and ends well outside it — exactly
     * the failure a spend ceiling exists to prevent.
     */
    const { data: settingRow } = await admin
      .from('system_settings')
      .select('value')
      .eq('key', 'daily_token_budget_per_user')
      .maybeSingle();
    const originalBudget = settingRow?.value ?? null;

    await admin
      .from('system_settings')
      .upsert({ key: 'daily_token_budget_per_user', value: 100 as never }, { onConflict: 'key' });

    const usageBefore = await admin
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const refused = await post({ prompt: 'hi', modelIds: [a.id, b.id] });
    const refusedBody = await refused.json().catch(() => ({}));

    check(
      'a comparison that would exceed the budget is refused',
      refused.status === 429,
      `got ${refused.status}`,
    );
    check(
      'and the refusal says how much room is left',
      typeof refusedBody.error === 'string' && /remain today/.test(refusedBody.error),
      String(refusedBody.error).slice(0, 120),
    );

    const usageAfterRefusal = await admin
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    check(
      'and NOTHING was spent — no usage rows were written',
      (usageAfterRefusal.count ?? 0) === (usageBefore.count ?? 0),
      `${usageBefore.count} → ${usageAfterRefusal.count}`,
    );

    // Restore before the live run.
    if (originalBudget !== null) {
      await admin
        .from('system_settings')
        .upsert(
          { key: 'daily_token_budget_per_user', value: originalBudget },
          { onConflict: 'key' },
        );
    } else {
      await admin.from('system_settings').delete().eq('key', 'daily_token_budget_per_user');
    }

    console.log('\nA real comparison\n');

    const live = await post({
      prompt: 'Reply with exactly the word: ready',
      modelIds: [a.id, b.id],
    });
    check('the stream starts', live.status === 200, `got ${live.status}`);

    const events = await readStream(live);
    const starts = events.filter((e) => e.type === 'model_start');
    const dones = events.filter((e) => e.type === 'model_done');
    const errors = events.filter((e) => e.type === 'model_error');
    const texts = events.filter((e) => e.type === 'text');

    check('every model announces itself', starts.length === 2, `${starts.length} starts`);
    check(
      'every model settles exactly once',
      dones.length + errors.length === 2,
      `${dones.length} done, ${errors.length} error`,
    );
    check('text arrived', texts.length > 0, `${texts.length} chunks`);
    check(
      'events are attributed to a model, so columns cannot be crossed',
      events.every((e) => typeof e.modelId === 'string' && e.modelId.length > 0),
    );

    for (const done of dones) {
      check(
        `${String(done.modelId).slice(0, 8)}: reports cost, tokens and latency`,
        typeof done.costUsd === 'number' &&
          typeof done.inputTokens === 'number' &&
          typeof done.outputTokens === 'number' &&
          typeof done.totalMs === 'number',
        JSON.stringify(done),
      );
      check(
        `${String(done.modelId).slice(0, 8)}: cost is derived, not zero-filled`,
        (done.outputTokens as number) === 0 || (done.costUsd as number) > 0,
        `${done.outputTokens} out, ${done.costUsd} usd`,
      );
    }

    const usageRows = await admin
      .from('usage_logs')
      .select('model_id, input_tokens, output_tokens, estimated_cost')
      .eq('user_id', userId);
    // Counted from zero: this user is created for this run and the refused
    // comparison above must have written nothing.
    check(
      'usage is recorded per model, so the budget cannot be bypassed here',
      (usageRows.data ?? []).length === dones.length,
      `${usageRows.data?.length} rows for ${dones.length} completions`,
    );
    check(
      'and every usage row carries a cost',
      (usageRows.data ?? []).every((r) => Number(r.estimated_cost) >= 0),
    );

    console.log('\nOne press failing does not cost the others\n');

    /**
     * A model row pointing at an id the provider does not have. The provider
     * rejects it; the other column must still finish.
     */
    const { data: bogus } = await admin
      .from('models')
      .insert({
        provider_id: (await admin.from('models').select('provider_id').eq('id', a.id).single())
          .data!.provider_id,
        model_id: 'model-that-does-not-exist',
        display_name: 'Broken press (test)',
        max_tokens: 256,
        enabled: true,
      })
      .select('id')
      .single();
    bogusModelId = bogus?.id ?? null;

    if (bogusModelId) {
      const mixed = await post({
        prompt: 'Reply with exactly the word: ready',
        modelIds: [a.id, bogusModelId],
      });
      const mixedEvents = await readStream(mixed);
      const okColumn = mixedEvents.filter((e) => e.type === 'model_done');
      const badColumn = mixedEvents.filter((e) => e.type === 'model_error');

      check('the request still succeeds', mixed.status === 200, `got ${mixed.status}`);
      check('the working press still answers', okColumn.length === 1, `${okColumn.length} done`);
      check(
        'the broken press reports its own failure',
        badColumn.length === 1,
        `${badColumn.length} errors`,
      );
      check(
        'and the failure message carries no vendor payload',
        badColumn.every(
          (e) =>
            typeof e.message === 'string' &&
            e.message.length > 0 &&
            !/api[_-]?key|sk-|Bearer/i.test(String(e.message)),
        ),
        String(badColumn[0]?.message).slice(0, 120),
      );
    }
  } finally {
    if (bogusModelId) await admin.from('models').delete().eq('id', bogusModelId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(
    failures === 0 ? '\nAll compare checks passed.' : `\n${failures} compare check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-compare crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
