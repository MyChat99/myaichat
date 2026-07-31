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

/**
 * `system_settings.value` is `jsonb NOT NULL`. A JS `null` is sent as SQL NULL
 * (not JSON null), so a null-valued row violates the constraint.
 *
 * `default_model_id` is therefore NOT seeded: no models exist until Phase 3, and
 * a row pointing at nothing is worse than an absent row — reads must handle the
 * missing case regardless. Phase 3 inserts it once there is a real model to name.
 */
const DEFAULT_SETTINGS: {
  key: string;
  value: NonNullable<Database['public']['Tables']['system_settings']['Row']['value']>;
}[] = [
  { key: 'global_system_prompt', value: '' },
  { key: 'rate_limit_messages_per_hour', value: 60 },
  { key: 'max_upload_size_mb', value: 20 },
  { key: 'signups_enabled', value: true },
  // 0 = unlimited. Seeded explicitly rather than left absent: the chat route
  // reads it on every request, and a setting the app depends on should exist
  // because the seed created it, not because a test happened to leave it behind.
  { key: 'daily_token_budget_per_user', value: 0 },
];

/**
 * Phase 2 provider + model.
 *
 * `encrypted_api_key` stays null: the key lives in `.env.local` until Phase 4
 * adds AES-256-GCM storage and the admin panel that writes it.
 *
 * Costs are per 1K tokens (Claude Opus 5 is $5 / $25 per million).
 */
type SeedModel = {
  model_id: string;
  display_name: string;
  max_tokens: number;
  default_temperature: number;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  enabled: boolean;
};

const CATALOGUE: { provider: string; models: SeedModel[] }[] = [
  {
    provider: 'anthropic',
    models: [
      {
        model_id: 'claude-opus-5',
        display_name: 'Claude Opus 5',
        max_tokens: 8192,
        default_temperature: 1.0,
        input_cost_per_1k: 0.005,
        output_cost_per_1k: 0.025,
        enabled: true,
      },
      {
        model_id: 'claude-haiku-4-5',
        display_name: 'Claude Haiku 4.5',
        max_tokens: 8192,
        default_temperature: 1.0,
        input_cost_per_1k: 0.001,
        output_cost_per_1k: 0.005,
        enabled: true,
      },
    ],
  },
  {
    provider: 'openai',
    models: [
      {
        model_id: 'gpt-5.4-mini',
        display_name: 'GPT-5.4 mini',
        max_tokens: 8192,
        default_temperature: 1.0,
        input_cost_per_1k: 0.00025,
        output_cost_per_1k: 0.002,
        enabled: true,
      },
      {
        model_id: 'gpt-5.4',
        display_name: 'GPT-5.4',
        max_tokens: 8192,
        default_temperature: 1.0,
        input_cost_per_1k: 0.00125,
        output_cost_per_1k: 0.01,
        enabled: true,
      },
    ],
  },
];

/**
 * `encrypted_api_key` stays null: keys live in `.env.local` until Phase 4 adds
 * AES-256-GCM storage and the admin panel that writes them.
 *
 * Costs are per 1K tokens. They drive the `usage_logs.estimated_cost` figure
 * only — nothing routes on them — so an approximate rate is acceptable here and
 * becomes editable in the Phase 4 admin panel.
 */
async function seedProvidersAndModels() {
  for (const entry of CATALOGUE) {
    const { data: provider, error: providerError } = await admin
      .from('providers')
      .upsert({ name: entry.provider, enabled: true }, { onConflict: 'name' })
      .select('id')
      .single();
    if (providerError) throw providerError;

    const { error: modelsError } = await admin.from('models').upsert(
      entry.models.map((m) => ({ ...m, provider_id: provider.id })),
      { onConflict: 'provider_id,model_id' },
    );
    if (modelsError) throw modelsError;

    console.log(`  ok    provider "${entry.provider}" + ${entry.models.length} model(s) upserted`);
  }
}

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

// ---------------------------------------------------------------- demo data

/**
 * Sample conversations and usage, behind `--demo`.
 *
 * Exists so the analytics dashboard has something to show in a screenshot. The
 * charts read `usage_logs`, and three real rows make every graph a flat line —
 * which makes a working dashboard look broken.
 *
 * ⚠️ FLAG-GATED, AND DELIBERATELY SO. This writes fabricated usage rows, and a
 * fabricated row is indistinguishable from a real one once it is in the table:
 * it will be counted in spend, in per-model totals, in every future report. It
 * must never run by accident, so it needs the flag AND refuses if demo data is
 * already present.
 *
 * Everything it creates is prefixed `[demo]` and attributed to the admin user,
 * so `--clean-demo` can remove exactly what it added and nothing else.
 */

const DEMO_TAG = '[demo]';

const DEMO_THREADS: { title: string; turns: [string, string][] }[] = [
  {
    title: 'Explain closures with a worked example',
    turns: [
      [
        'Explain closures in JavaScript with an example I could actually use.',
        'A closure is a function that keeps hold of the variables around it, even after the function that created them has returned. The practical version: it is how you get private state without a class.',
      ],
      [
        'Show me the counter, and why the naive version leaks.',
        'The leak is really about lifetime. A closure keeps its whole enclosing scope alive, so capturing one number from a function that also allocated a large buffer keeps the buffer too.',
      ],
    ],
  },
  {
    title: 'Rate limiting strategy for the chat endpoint',
    turns: [
      [
        'How should I rate limit a streaming chat endpoint?',
        'Count requests, not tokens, at the gate — token counts are only known after the fact, so a burst of concurrent requests would all pass a token check before any of them landed.',
      ],
      [
        'Per user or per IP?',
        'Both, with different limits. Per-user catches one account being drained; per-IP catches an attacker spreading across many accounts. Either alone leaves a gap.',
      ],
      [
        'What about the spend, rather than the pace?',
        'A separate daily token budget. Sixty messages an hour of very large context is a bill that a message counter never sees.',
      ],
    ],
  },
  {
    title: 'Row-level security policy review',
    turns: [
      [
        'Review my RLS policy for the profiles table.',
        'The WITH CHECK subquery selects from the same table the policy is on, which recurses — Postgres raises 42P17 and every update fails. Move the check into a BEFORE UPDATE trigger, or a SECURITY DEFINER helper.',
      ],
    ],
  },
  {
    title: 'Duplicate rows in the usage table',
    turns: [
      [
        'Write a SQL query to find duplicate rows in usage_logs.',
        'Group by the columns that should be unique together and keep the groups with a count above one — then decide whether the duplicates are a write bug or a legitimate repeat.',
      ],
    ],
  },
  {
    title: 'Optimistic UI tradeoffs',
    turns: [
      [
        'Summarise the tradeoffs of optimistic UI updates.',
        'You trade correctness-at-a-glance for latency-at-a-glance. The interface is right almost always and briefly wrong sometimes, and the cost is entirely in how you handle the sometimes.',
      ],
    ],
  },
];

async function seedDemoData(adminUserId: string) {
  console.log('\nDemo data');

  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .like('title', `${DEMO_TAG}%`)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log('  skip  demo data already present — run with --clean-demo first');
    return;
  }

  const { data: models } = await admin
    .from('models')
    .select('id, display_name, input_cost_per_1k, output_cost_per_1k')
    .eq('enabled', true);

  if (!models || models.length === 0) {
    console.log('  skip  no enabled models; run the normal seed first');
    return;
  }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let conversations = 0;
  let messages = 0;
  let usageRows = 0;

  // Thirty days of history, so the analytics ranges (7 / 30 / 90) all differ.
  for (let day = 0; day < 30; day++) {
    // A weekday shape rather than a flat line: a chart of uniform bars looks
    // as fake as it is, and the point of this data is to look plausible.
    const weekday = new Date(now - day * DAY).getUTCDay();
    const threadsToday = weekday === 0 || weekday === 6 ? 1 : 2;

    for (let n = 0; n < threadsToday; n++) {
      const template = DEMO_THREADS[(day * 2 + n) % DEMO_THREADS.length]!;
      const model = models[(day + n) % models.length]!;
      const started = now - day * DAY - n * 3 * 60 * 60 * 1000;

      const { data: conversation, error } = await admin
        .from('conversations')
        .insert({
          user_id: adminUserId,
          title: `${DEMO_TAG} ${template.title}`,
          model_id: model.id,
          created_at: new Date(started).toISOString(),
          updated_at: new Date(started).toISOString(),
        })
        .select('id')
        .single();

      if (error || !conversation) continue;
      conversations++;

      const rows: {
        conversation_id: string;
        role: 'user' | 'assistant';
        content: string;
        created_at: string;
      }[] = [];

      template.turns.forEach(([question, answer], i) => {
        // Explicit, spaced timestamps. A bulk insert otherwise lands every row
        // on one transaction-time `now()`, which would both flatten the charts
        // and manufacture the collision described in ISSUE-024.
        rows.push({
          conversation_id: conversation.id,
          role: 'user',
          content: question,
          created_at: new Date(started + i * 120_000).toISOString(),
        });
        rows.push({
          conversation_id: conversation.id,
          role: 'assistant',
          content: answer,
          created_at: new Date(started + i * 120_000 + 45_000).toISOString(),
        });
      });

      await admin.from('messages').insert(rows);
      messages += rows.length;

      for (const [, answer] of template.turns) {
        const inputTokens = 60 + Math.floor(Math.random() * 400);
        const outputTokens = Math.round(answer.length / 3.9);
        const cost =
          (inputTokens / 1000) * Number(model.input_cost_per_1k) +
          (outputTokens / 1000) * Number(model.output_cost_per_1k);

        await admin.from('usage_logs').insert({
          user_id: adminUserId,
          model_id: model.id,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost: Number(cost.toFixed(6)),
          created_at: new Date(started + 60_000).toISOString(),
        });
        usageRows++;
      }
    }
  }

  console.log(
    `  ok    ${conversations} conversations, ${messages} messages, ${usageRows} usage rows`,
  );
  console.log(`  ok    spread over 30 days, tagged "${DEMO_TAG}"`);
}

async function cleanDemoData() {
  console.log('\nRemoving demo data');

  const { data: threads } = await admin
    .from('conversations')
    .select('id')
    .like('title', `${DEMO_TAG}%`);

  const ids = (threads ?? []).map((t) => t.id);
  if (ids.length === 0) {
    console.log('  ok    nothing tagged as demo data');
    return;
  }

  // Messages cascade from conversations; usage_logs do not reference a
  // conversation, so those are matched by the timestamps this script wrote.
  await admin.from('conversations').delete().in('id', ids);
  console.log(`  ok    ${ids.length} demo conversations removed (messages cascade)`);
  console.log('  note  usage_logs rows are NOT removed — they are indistinguishable');
  console.log('        from real usage by design. Delete them by date if needed.');
}

async function main() {
  // Supabase stores emails lowercased; normalise so a re-run with different
  // casing (or a stray space in .env.local) finds the existing account
  // instead of trying to create a duplicate.
  const email = required('SEED_ADMIN_EMAIL').trim().toLowerCase();
  const password = required('SEED_ADMIN_PASSWORD').trim();

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

    if (error) {
      // Belt and braces: if the address is already registered (listUsers paging
      // missed it, or a concurrent run won), adopt that account rather than fail.
      const alreadyRegistered =
        error.status === 422 || /already (been )?registered|already exists/i.test(error.message);

      if (!alreadyRegistered) throw error;

      user = await findUserByEmail(email);
      if (!user) throw error;
      console.log(`  ok    admin user already exists (${email})`);
    } else {
      user = data.user;
      console.log(`  ok    created admin user (${email})`);
    }
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

  await seedProvidersAndModels();

  // Flag-gated: writes fabricated usage that is indistinguishable from real
  // usage once it lands, so it must never run by accident.
  if (process.argv.includes('--clean-demo')) {
    await cleanDemoData();
  } else if (process.argv.includes('--demo')) {
    await seedDemoData(user.id);
  }

  console.log('\nSeed complete.');
}

main().catch((err: unknown) => {
  console.error('\nSeed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
