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
  // Empty = any domain. See lib/security/signup-policy.ts.
  { key: 'signup_allowed_domains', value: '' },
  // Dollars per calendar month across every user, with a HARD cutoff. Unlike
  // the other limits, an absent value does not mean unlimited — see
  // lib/security/spend-ceiling.ts for why this one fails closed.
  { key: 'monthly_spend_ceiling_usd', value: 25 },
  // 0 = unlimited. Seeded explicitly rather than left absent: the chat route
  // reads it on every request, and a setting the app depends on should exist
  // because the seed created it, not because a test happened to leave it behind.
  { key: 'daily_token_budget_per_user', value: 0 },
  // 0 = no idle expiry. Default off on purpose: this signs users out, and it
  // should be an administrator's deliberate choice rather than a surprise.
  { key: 'session_idle_timeout_minutes', value: 0 },
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
  /**
   * The per-request OUTPUT cap, not the context window — the column is what
   * gets sent as `max_tokens`. Held at 8192 across the catalogue: several of
   * these models will emit far more if asked, and an interactive chat that can
   * bill 32k of output per turn is a bill nobody agreed to.
   */
  max_tokens: number;
  default_temperature: number;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  enabled: boolean;
  /** Attachments are offered per model, so this must be true only where it is. */
  supports_vision?: boolean;
  supports_documents?: boolean;
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
    /**
     * Groq — open-weight models on their own inference hardware.
     *
     * Ids, context windows and prices from console.groq.com/docs/models and
     * groq.com/pricing, read 2026-08-02. Prices there are per MILLION tokens;
     * this column is per THOUSAND, hence the factor of 1000.
     *
     * None are flagged for vision: Groq's production text catalogue does not
     * document image input for these ids, and guessing true would offer users a
     * paperclip that fails on send.
     */
    provider: 'groq',
    models: [
      {
        // 131,072 context · 32,768 max output · $0.59/$0.79 per 1M
        model_id: 'llama-3.3-70b-versatile',
        display_name: 'Llama 3.3 70B',
        max_tokens: 8192,
        default_temperature: 1.0,
        input_cost_per_1k: 0.00059,
        output_cost_per_1k: 0.00079,
        enabled: true,
      },
      {
        // 131,072 context · 131,072 max output · $0.05/$0.08 per 1M
        model_id: 'llama-3.1-8b-instant',
        display_name: 'Llama 3.1 8B Instant',
        max_tokens: 8192,
        default_temperature: 1.0,
        input_cost_per_1k: 0.00005,
        output_cost_per_1k: 0.00008,
        enabled: true,
      },
      {
        // 131,072 context · 65,536 max output · $0.15/$0.60 per 1M
        model_id: 'openai/gpt-oss-120b',
        display_name: 'GPT-OSS 120B',
        max_tokens: 8192,
        default_temperature: 1.0,
        input_cost_per_1k: 0.00015,
        output_cost_per_1k: 0.0006,
        enabled: true,
      },
      {
        // 131,072 context · 65,536 max output · $0.075/$0.30 per 1M
        model_id: 'openai/gpt-oss-20b',
        display_name: 'GPT-OSS 20B',
        max_tokens: 8192,
        default_temperature: 1.0,
        input_cost_per_1k: 0.000075,
        output_cost_per_1k: 0.0003,
        enabled: true,
      },
    ],
  },
  {
    /**
     * Perplexity — search-grounded answers.
     *
     * Prices from docs.perplexity.ai/getting-started/pricing, read 2026-08-02,
     * per MILLION tokens and divided by 1000 here.
     *
     * ⚠️ Sonar bills per search request as well as per token, and this app
     * records only tokens. Analytics will therefore UNDERSTATE Perplexity spend.
     * That is a known limitation rather than an oversight — logged in ISSUES.md
     * — and it is why `sonar-deep-research`, whose search fees dominate its
     * cost, is not seeded at all.
     */
    provider: 'perplexity',
    models: [
      {
        // $1.00 / $1.00 per 1M
        model_id: 'sonar',
        display_name: 'Sonar',
        max_tokens: 4096,
        default_temperature: 1.0,
        input_cost_per_1k: 0.001,
        output_cost_per_1k: 0.001,
        enabled: true,
      },
      {
        // $3.00 / $15.00 per 1M
        model_id: 'sonar-pro',
        display_name: 'Sonar Pro',
        max_tokens: 4096,
        default_temperature: 1.0,
        input_cost_per_1k: 0.003,
        output_cost_per_1k: 0.015,
        enabled: true,
      },
      {
        // $2.00 / $8.00 per 1M
        model_id: 'sonar-reasoning-pro',
        display_name: 'Sonar Reasoning Pro',
        max_tokens: 4096,
        default_temperature: 1.0,
        input_cost_per_1k: 0.002,
        output_cost_per_1k: 0.008,
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

/** Written to `usage_logs.source`. Real usage leaves that column NULL. */
const DEMO_SOURCE = 'demo';

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
      [
        'So the helper has to be SECURITY DEFINER?',
        'Yes — it needs to read the table the policy guards without re-entering the policy. Mark it STABLE too, so the planner can call it once per statement rather than once per row.',
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
      [
        'How do I stop them being written in the first place?',
        'A unique constraint on whatever combination should not repeat. Finding duplicates is a report; preventing them is a schema change, and only the second one holds.',
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
      [
        'What is the worst case in a chat interface?',
        'Showing a message as sent that never landed. Keep the optimistic row visually distinct until the server confirms it, and make the failure path put the text back in the composer rather than discarding it.',
      ],
    ],
  },
  {
    title: 'Why my index is being ignored',
    turns: [
      [
        'I added an index and the query plan still says sequential scan.',
        'On a small table that is correct behaviour, not a broken index. Postgres compares estimated costs, and reading 178 rows sequentially is cheaper than walking a B-tree and then fetching the heap. Benchmark against a table the size you expect, not the one you have.',
      ],
      [
        'How do I test the index then?',
        "Generate a table at the size you expect into a temporary table, run EXPLAIN ANALYZE there, and keep the numbers. That turns 'this should help' into a measurement you can put in the commit message.",
      ],
    ],
  },
  {
    title: 'AES-GCM: where does the IV go?',
    turns: [
      [
        'Storing an AES-256-GCM encrypted value — do I need to keep the IV separately?',
        'Store it alongside; it is not secret, it only has to be unique per key. The usual shape is a single field of version.iv.tag.ciphertext so one string carries everything needed to decrypt and nothing can be paired with the wrong IV.',
      ],
      [
        'What actually breaks if an IV repeats?',
        'With GCM, catastrophically more than confidentiality — a repeated IV under the same key leaks the authentication subkey, so an attacker can forge messages, not merely read them.',
      ],
    ],
  },
  {
    title: 'Streaming without Server-Sent Events',
    turns: [
      [
        'Can I use EventSource for a chat endpoint that needs a POST body?',
        'No — EventSource issues a GET and cannot carry a body. Either put the payload in a query string, which caps out and lands conversation text in access logs, or stream a POST response yourself and read the body as chunks. NDJSON over fetch is the usual answer.',
      ],
      [
        'What does the client side look like?',
        'Read `response.body` as a stream, decode chunks, and split on newlines. Buffer the remainder — a chunk boundary lands mid-line often enough that ignoring it works in development and fails in production.',
      ],
    ],
  },
  {
    title: 'Debouncing a search box properly',
    turns: [
      [
        'My debounced search still fires on every keystroke.',
        'The timer is almost certainly being recreated each render, so it never lives long enough to be cleared. Keep it in a ref, or move the debounce outside the component entirely.',
      ],
      [
        'Should the request be cancelled as well?',
        'Yes, or you get results arriving out of order and the older, slower response overwriting the newer one. An AbortController per keystroke is the cheap fix.',
      ],
    ],
  },
  {
    title: 'Cascade deletes and orphaned rows',
    turns: [
      [
        'If I delete a conversation, do the messages go too?',
        'Only if the foreign key says on delete cascade. Without it the delete fails outright, or worse succeeds and leaves orphans, depending on how the constraint was written.',
      ],
      [
        'What about rows that reference a user who is deleted?',
        'Decide per column: cascade where the row is meaningless without the user, set null where it is still worth keeping. Usage records usually want set null, so the totals survive an account closing.',
      ],
    ],
  },
  {
    title: 'Reading a query plan for the first time',
    turns: [
      [
        'How do I read EXPLAIN ANALYZE output without drowning?',
        'Read it inside out — the deepest node runs first. Compare estimated rows against actual rows at each level: where those diverge by an order of magnitude is where the planner was misled, and that is usually the whole story.',
      ],
      [
        'What counts as a bad number?',
        "Rows off by an order of magnitude, or a nested loop over thousands of rows where a hash join belonged. Both mean the planner's statistics disagree with reality, which ANALYZE often fixes on its own.",
      ],
    ],
  },
  {
    title: 'Retry storms and jittered backoff',
    turns: [
      [
        'Is exponential backoff enough to protect an upstream service?',
        'Not on its own. Without jitter, every client that failed at the same moment retries at the same moment, so you have rebuilt the spike you were trying to smooth. Add randomness proportional to the delay.',
      ],
      [
        'How many attempts before giving up?',
        'Fewer than instinct suggests. Three is usually right for an interactive request: past that the user has already decided the app is broken, and you are only spending someone else quota to confirm it.',
      ],
    ],
  },
  {
    title: 'CSV injection in an export',
    turns: [
      [
        'Is there anything to sanitise in a CSV export?',
        'Yes — a cell beginning with =, +, - or @ is treated as a formula by spreadsheet software, which will happily execute it on open. Prefix such cells with an apostrophe, or wrap them, before writing.',
      ],
      [
        'Does quoting not handle it?',
        'Quoting solves the delimiter problem, not the formula problem — a spreadsheet strips the quotes and still sees a leading equals sign. They are two different escapes and you need both.',
      ],
    ],
  },
  {
    title: 'Keeping secrets out of logs',
    turns: [
      [
        'How do I make sure an API key never lands in a log line?',
        'Stop relying on scrubbing the output and constrain the input: make the log payload a fixed set of typed fields with nowhere to put a secret. A regex filter runs second, as insurance, not first as the design.',
      ],
      [
        'What about the error messages from upstream?',
        'Those are the dangerous ones — an upstream error frequently quotes the request back, including the credential it rejected. Scrub the field before it is written rather than trusting where it came from.',
      ],
    ],
  },
  {
    title: 'Idempotent webhooks',
    turns: [
      [
        'A payment webhook fired twice and we charged twice. What is the fix?',
        'Treat the provider event id as a unique key and write it in the same transaction as the effect. Then the second delivery violates the constraint and becomes a no-op instead of a second charge.',
      ],
      [
        'Where should the key live?',
        'In its own table with a unique index, written in the same transaction as the effect. Keeping it beside the effect is what makes the two atomic; a cache in front of the handler is not.',
      ],
    ],
  },
  {
    title: 'Timezones in a daily report',
    turns: [
      [
        'My "today" numbers disagree with the dashboard by a few hours.',
        'Something is bucketing in local time and something else in UTC. Pick one, name it in the column comment, and convert only at the point of display.',
      ],
      [
        'Which one should I pick?',
        "UTC for storage and aggregation, always. Convert to the reader's zone in the interface, where you know who is asking — a stored local timestamp cannot be corrected later because the offset is gone.",
      ],
    ],
  },
  {
    title: 'When to reach for a database view',
    turns: [
      [
        'Row-level security cannot hide a column, so how do I expose a table with a secret in it?',
        'You do not — you expose a view over it that simply does not select that column, and revoke direct access to the base table. RLS decides which rows; the view decides which columns.',
      ],
      [
        'Does the view need its own policies?',
        'In Postgres a view runs with the privileges of its owner by default, which quietly bypasses RLS on the base table. Either make it security_invoker or accept that the view itself is the boundary and lock down who can select from it.',
      ],
    ],
  },
  {
    title: 'Testing without a test framework',
    turns: [
      [
        'Is it defensible to have assertions but no test framework?',
        'It depends what the bugs look like. If they are integration-shaped — a policy that recurses, a query returning the wrong end of a sort — then a script hitting a real database catches them and a mocked unit test does not. What you give up is watch mode and structured reporting.',
      ],
      [
        'What is the honest downside?',
        'No isolation. Suites share one database, so one leaving a row behind breaks the next, and you find out through an unrelated failure. It is fixable with discipline, but the framework would have given it to you for free.',
      ],
    ],
  },
  {
    title: 'A migration that cannot be rolled back',
    turns: [
      [
        'How careful should I be about dropping a column?',
        'Treat it as irreversible, because it is: the data is gone the moment it runs, and a down migration recreates the column empty. Stop writing it, deploy, wait, then drop in a later migration.',
      ],
      [
        'What does a safe sequence look like?',
        'Add the new column, backfill, start writing both, switch reads, stop writing the old one, then drop it — five deploys. It feels absurd until the one time you need to stop halfway.',
      ],
    ],
  },
  {
    title: 'Prefers-reduced-motion, in practice',
    turns: [
      [
        'What actually needs to change when a user asks for reduced motion?',
        'Anything that moves large areas, loops, or animates without the user asking — parallax, autoplay carousels, entrance animations on every item. Small state-change transitions can usually stay; the guideline targets vestibular triggers, not all motion.',
      ],
      [
        'Is disabling every transition the safe default?',
        'It is safe but worse — instant state changes make an interface feel broken. Reduce duration rather than removing it, and cut anything that travels a long distance or repeats.',
      ],
    ],
  },
  {
    title: 'Choosing a contrast ratio target',
    turns: [
      [
        'Is 4.5:1 enough for body text?',
        'It is the AA threshold for normal-size text, so it is the floor rather than a goal. Large text drops to 3:1. Anything you expect people to read for minutes at a time is worth more headroom than the minimum.',
      ],
      [
        'How do I check it without eyeballing?',
        'Compute it from the tokens rather than from screenshots. If the palette is data, every pairing can be checked automatically, and a new theme gets checked without anyone writing a new test.',
      ],
    ],
  },
  {
    title: 'What a model knows about itself',
    turns: [
      [
        'Which model are you, and how do you know?',
        'I am told. A model is finished before it is deployed, so its own version number is generally not in its training data — which is why models elsewhere answer this confidently and wrongly. Here the application writes the selected model name into the system prompt, so the answer tracks the setting.',
      ],
      [
        'So it could still be wrong?',
        'It could be wrong about anything not in the prompt, yes. What it cannot be wrong about here is the name, because that came from the application rather than from memory.',
      ],
    ],
  },
  {
    title: 'Presigned uploads and the CORS surprise',
    turns: [
      [
        'The presigned URL works from the server but fails in the browser.',
        'That is CORS, not credentials — the browser preflights the PUT and the bucket has to allow the origin, the method and the content-type header explicitly. Proving the round trip server-side first is what lets you say that with confidence.',
      ],
      [
        'Which headers does the bucket need to allow?',
        'The method you presigned for, the origin you are calling from, and content-type — that last one is the usual omission, because the browser only preflights once you set it.',
      ],
    ],
  },
  {
    title: 'Counting tokens before sending',
    turns: [
      [
        'Do I need an exact token count before a request?',
        'Rarely. An estimate good to a few percent is enough to decide whether to truncate; exactness only matters if you are billing on your own count rather than the provider reported one.',
      ],
      [
        'What is a reasonable truncation strategy?',
        'Keep the system prompt and the most recent turns, drop from the middle, and tell the user you did. Silently forgetting the start of a conversation is worse than a visible boundary.',
      ],
    ],
  },
];

async function seedDemoData(adminUserId: string) {
  console.log('\nDemo data');

  // Both tables are checked. Looking only at conversations is what allowed a
  // clean-then-reseed to pass this guard and write a SECOND full set of usage
  // rows, because cleanup could not remove the first set.
  const [{ data: existingThreads }, { count: existingUsage }] = await Promise.all([
    admin.from('conversations').select('id').like('title', `${DEMO_TAG}%`).limit(1),
    admin.from('usage_logs').select('*', { count: 'exact', head: true }).eq('source', DEMO_SOURCE),
  ]);

  if ((existingThreads && existingThreads.length > 0) || (existingUsage ?? 0) > 0) {
    console.log(
      `  skip  demo data already present (${existingThreads?.length ?? 0} thread(s), ${existingUsage ?? 0} usage row(s)) — run with --clean-demo first`,
    );
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

  /**
   * Each template is used exactly ONCE.
   *
   * The previous version ran a fixed 30-day × 2-per-weekday loop and indexed
   * into the pool modulo its length — 52 conversations drawn from six
   * templates, so every title appeared about nine times. In a sidebar that is
   * unmistakably fake, and the screenshots this data exists for were the one
   * place it would be seen.
   *
   * Driving the loop from the pool instead means the pool size IS the amount of
   * data: adding a template adds a conversation, and no title can repeat.
   */
  const queue = [...DEMO_THREADS];
  let cursor = 0;

  // Thirty days of history, so the analytics ranges (7 / 30 / 90) all differ.
  for (let day = 0; day < 30 && cursor < queue.length; day++) {
    // A weekday shape rather than a flat line: a chart of uniform bars looks
    // as fake as it is, and the point of this data is to look plausible.
    const weekday = new Date(now - day * DAY).getUTCDay();
    const threadsToday = weekday === 0 || weekday === 6 ? 1 : 2;

    for (let n = 0; n < threadsToday && cursor < queue.length; n++) {
      const template = queue[cursor++]!;
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
          // What makes this row removable. Real usage leaves it NULL.
          source: DEMO_SOURCE,
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
    // Deliberately does NOT return: usage rows can outlive their conversations
    // (that was the bug), so cleanup has to try both independently.
    console.log('  ok    no demo conversations to remove');
  }

  // Messages cascade from conversations. Usage rows do not reference a
  // conversation, so they are matched on the source tag this script writes —
  // which is the whole reason that column exists.
  if (ids.length > 0) {
    await admin.from('conversations').delete().in('id', ids);
    console.log(`  ok    ${ids.length} demo conversations removed (messages cascade)`);
  }

  const { count, error } = await admin
    .from('usage_logs')
    .delete({ count: 'exact' })
    .eq('source', DEMO_SOURCE);

  if (error) {
    console.error(`  FAIL  usage rows not removed — ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  ok    ${count ?? 0} demo usage rows removed`);
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
