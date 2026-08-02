/**
 * Proves the Phase 3 acceptance criteria.
 *
 * The load-bearing check is the abstraction one: it greps the codebase to prove
 * no vendor SDK or provider name leaks outside lib/providers. A passing chat on
 * two providers does not prove the abstraction — you can get that with an
 * if/else in the route handler.
 *
 *   npm run dev              # in another terminal
 *   npm run verify:providers # BASE_URL=http://localhost:3001 to override the port
 */
import { execFileSync } from 'node:child_process';
import { createClient, type Session } from '@supabase/supabase-js';

import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const CHUNK_SIZE = 3180;

const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = process.pid;
const PASSWORD = 'provider-test-password-1234';

let failures = 0;

function check(name: string, passed: boolean, detail = '') {
  if (passed) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function sessionCookie(session: Session): string {
  const name = `sb-${projectRef}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`;
  if (value.length <= CHUNK_SIZE) return `${name}=${value}`;
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(`${name}.${chunks.length}=${value.slice(i, i + CHUNK_SIZE)}`);
  }
  return chunks.join('; ');
}

/** Greps tracked files, excluding lib/providers. Returns matching paths. */
function grepOutsideProviders(pattern: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-lE', pattern, '--', 'app', 'components', 'lib', 'scripts'],
      { encoding: 'utf8' },
    );
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((p) => !p.startsWith('lib/providers/'));
  } catch {
    return []; // git grep exits non-zero when there are no matches
  }
}

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const client = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  return { id: data.user.id, cookie: sessionCookie(signIn.session!) };
}

async function chat(cookie: string, conversationId: string, message: string) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ conversationId, message }),
  });

  if (!response.ok || !response.body) return { text: '', error: `HTTP ${response.status}` };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let error: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type: string; text?: string; message?: string };
      if (event.type === 'text') text += event.text ?? '';
      if (event.type === 'error') error = event.message ?? 'error';
    }
  }

  return { text, error };
}

async function main() {
  console.log('Provider abstraction\n');

  // --- the criterion that actually matters ---------------------------------
  const sdkLeaks = grepOutsideProviders("from '(@anthropic-ai/sdk|openai)'");
  check('no vendor SDK imported outside lib/providers', sdkLeaks.length === 0, sdkLeaks.join(', '));

  // Provider names may appear in the seed catalogue and the registry map, but
  // must not appear in routes or UI — that would mean branching on vendor.
  //
  // `lib/security/password.ts` is exempt: it lists 'anthropic', 'openai' and
  // 'claude' in a blocklist of guessable passwords, which is a string table,
  // not a branch on vendor. The exemption is one named file rather than a
  // pattern, so it cannot quietly grow to cover real coupling.
  const NAME_EXEMPT = ['scripts/', 'lib/security/password.ts'];
  const nameLeaks = grepOutsideProviders("'(anthropic|openai)'").filter(
    (p) => !NAME_EXEMPT.some((prefix) => p.startsWith(prefix)),
  );
  check(
    'no provider name hardcoded in routes or components',
    nameLeaks.length === 0,
    nameLeaks.join(', '),
  );

  const { registeredProviderNames } = await import('../lib/providers/registry');
  check(
    'at least two providers registered',
    registeredProviderNames().length >= 2,
    registeredProviderNames().join(', '),
  );

  // --- registry ------------------------------------------------------------
  const { listAvailableModels } = await import('../lib/providers/registry');
  const models = await listAvailableModels();
  const providers = new Set(models.map((m) => m.providerName));

  check(
    'registry resolves models from the database',
    models.length > 0,
    `${models.length} model(s)`,
  );
  check('models span both providers', providers.size >= 2, [...providers].join(', '));
  check(
    'every resolved model carries cost fields',
    models.every((m) => m.inputCostPer1k >= 0 && m.outputCostPer1k >= 0),
  );

  // --- adapters ------------------------------------------------------------
  const { getAdapter, configuredProviderNames } = await import('../lib/providers/registry');

  /**
   * A provider with no key is SKIPPED, not failed.
   *
   * Every registered adapter is exercised for interface conformance, but the
   * legs that spend money need a credential, and a repository is expected to
   * carry adapters for providers this particular deployment has not paid for.
   * `getAdapter()` throws in that case — deliberately, so a misconfiguration in
   * the chat route is loud — so the throw is caught here and reported rather
   * than ending the run.
   */
  const live: string[] = [];
  const unconfigured: string[] = [];

  for (const provider of providers) {
    try {
      const adapter = await getAdapter(provider);
      check(
        `${provider}: adapter implements the full interface`,
        typeof adapter.streamChat === 'function' &&
          typeof adapter.listModels === 'function' &&
          typeof adapter.validateKey === 'function',
      );
      live.push(provider);
    } catch {
      unconfigured.push(provider);
      console.log(`  skip  ${provider}: no API key configured in this environment`);
    }
  }

  /**
   * An adapter without a key must not put models in front of a user.
   *
   * Registering a provider and seeding its catalogue is not the same as having
   * paid for it. Before this was enforced, a freshly-seeded deployment offered
   * every model of every provider it had no key for — the picker listed them,
   * the empty state counted them, and choosing one failed only after the user
   * had typed a message and pressed send.
   */
  const offeredProviders = new Set(models.map((m) => m.providerName));
  const configured = new Set(await configuredProviderNames());

  check(
    'every OFFERED model comes from a provider that holds a key',
    [...offeredProviders].every((p) => configured.has(p)),
    `offered: ${[...offeredProviders].join(', ')} · configured: ${[...configured].join(', ')}`,
  );

  const registeredButUnconfigured = registeredProviderNames().filter((p) => !configured.has(p));
  check(
    'a registered provider with no key offers nothing',
    registeredButUnconfigured.every((p) => !offeredProviders.has(p)),
    registeredButUnconfigured.join(', ') || 'all providers are configured',
  );
  if (registeredButUnconfigured.length > 0) {
    console.log(
      `        ↳ registered but unconfigured, correctly hidden: ${registeredButUnconfigured.join(', ')}`,
    );
  }

  check(
    'at least two providers are configured to run against',
    live.length >= 2,
    `configured: ${live.join(', ') || 'none'}`,
  );

  for (const provider of live) {
    const adapter = await getAdapter(provider);
    const validation = await adapter.validateKey();
    check(
      `${provider}: validateKey() confirms the key can generate`,
      validation.valid,
      validation.reason,
    );

    const list = await adapter.listModels();
    check(`${provider}: listModels() returns models`, list.length > 0, `${list.length} model(s)`);
  }

  // --- same UX on both providers -------------------------------------------
  console.log('\nEnd-to-end per provider\n');

  try {
    await fetch(BASE_URL, { redirect: 'manual' });
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first (npm run dev).`);
    process.exit(1);
  }

  const user = await makeUser(`provider-${stamp}@example.com`);

  try {
    // One model per CONFIGURED provider, so every code path with a credential
    // runs the same conversation flow.
    const perProvider = live
      .map((p) => models.find((m) => m.providerName === p))
      .filter((m): m is (typeof models)[number] => Boolean(m));

    const conversations: { model: (typeof models)[number]; conversationId: string }[] = [];

    for (const model of perProvider) {
      const { data: convo } = await admin
        .from('conversations')
        .insert({ user_id: user.id, title: 'New chat', model_id: model.id })
        .select('id')
        .single();

      const result = await chat(user.cookie, convo!.id, 'Reply with exactly: OK');
      check(
        `${model.providerName} (${model.displayName}): streams a reply`,
        result.text.length > 0 && !result.error,
        result.error ?? `got "${result.text}"`,
      );

      conversations.push({ model, conversationId: convo!.id });
    }

    // usage_logs must be attributed to the right model, per provider.
    for (const { model } of conversations) {
      const { data: usage } = await admin
        .from('usage_logs')
        .select('input_tokens, output_tokens, estimated_cost')
        .eq('user_id', user.id)
        .eq('model_id', model.id);

      const rows = usage ?? [];
      check(
        `${model.providerName}: usage_logs row attributed to the right model`,
        rows.length >= 1,
        `${rows.length} row(s)`,
      );
      check(
        `${model.providerName}: token counts recorded`,
        rows.some((r) => r.input_tokens > 0 && r.output_tokens > 0),
        JSON.stringify(rows[0] ?? {}),
      );
    }

    // --- switching model mid-conversation ----------------------------------
    if (conversations.length >= 2) {
      const [first, second] = conversations;

      await admin
        .from('conversations')
        .update({ model_id: second.model.id })
        .eq('id', first.conversationId);

      const switched = await chat(
        user.cookie,
        first.conversationId,
        'Reply with exactly: SWITCHED',
      );
      check(
        'switching model mid-conversation works',
        switched.text.length > 0 && !switched.error,
        switched.error ?? '',
      );

      const { count } = await admin
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('model_id', second.model.id);

      check(
        'the switched-to model is billed for the new turn',
        (count ?? 0) >= 2,
        `${count} row(s) for ${second.model.displayName}`,
      );
    }
  } finally {
    await admin.auth.admin.deleteUser(user.id).catch(() => {});
    console.log('\nTest user cleaned up.');
  }

  console.log(
    failures === 0 ? '\nAll provider checks passed.' : `\n${failures} provider check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nverify-providers crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
