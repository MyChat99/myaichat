# Progress

> ## ⏸ SESSION PAUSED — 2026-07-31
>
> **Read this block first. Delete it when work resumes.**
>
> ### State at pause
>
> Everything is committed, pushed and merged. Working tree clean, `main` in sync
> with origin, CI green, **17 verification suites all passing**. Nothing was
> left half-finished — the last task (branch protection) completed, was proven,
> and merged through PR #7.
>
> ### ⚠️ The one thing that changed how you work
>
> **`main` is protected and administrators are bound by it.** Direct pushes are
> rejected. Every change — yours or an agent's — now goes:
>
> ```bash
> git checkout -b <type>/<short-name>
> # ... work ...
> git push -u origin <branch>
> gh pr create --base main --title "..." --body "..."
> gh run watch $(gh run list --branch <branch> --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
> gh pr merge <n> --squash --delete-branch
> ```
>
> `git push origin main` will fail with `GH006`. That is correct, not broken.
> See [DEC-016](DECISIONS.md); the deliberate bypass is in [ISSUE-018](ISSUES.md).
>
> ### First command when you resume
>
> ```bash
> git pull && npm install && npm run lint && npm run type-check && npm run build
> ```
>
> Then, if you want the full picture before deciding anything:
>
> ```bash
> npm run dev                       # a server is needed by six of the suites
> npm run verify:api                # 61 checks — the broadest single signal
> ```
>
> ### What was in progress
>
> **Nothing.** The away session finished all six of its priorities, and the
> branch-protection task that followed it is closed. There is no partial work,
> no stashed change, no branch left open.
>
> ### What is next, in the order I would do it
>
> | # | Task | Blocked by | Where the instructions are |
> | --- | --- | --- | --- |
> | 1 | **R2 + Resend credentials → finish Phase 6** | you having accounts | [PHASE-6-CHECKLIST.md](PHASE-6-CHECKLIST.md) — nothing in it needs a code change |
> | 2 | **Screenshots for the README** | needs a browser | run `npm run seed -- --demo` first; four placeholders wait in `docs/screenshots/` |
> | 3 | **Four human checks from the away session** | needs your eyes | attachment UI, analytics charts, export links, mobile — listed in the Away-session report |
> | 4 | **Decide on Dependabot PRs #1–#4** | your call | #2 and #1 want actions at v7; I set v5 last session |
> | 5 | **ISSUE-024** — truncation deletes by timestamp | nothing; it is just structural | needs a `seq` column, a migration, and every `created_at`-ordered read path updated |
> | 6 | **Chain CI to the Railway deploy** | your call | comment inside `.github/workflows/ci.yml` |
>
> Phase 7's remaining tasks (performance pass, accessibility audit) still need a
> browser and Lighthouse, so they stay unmeasurable headlessly — see the Phase 7
> section below.
>
> ### Open issues worth knowing about
>
> | Issue | What it is |
> | --- | --- |
> | [ISSUE-016](ISSUES.md) / [ISSUE-017](ISSUES.md) / [ISSUE-003](ISSUES.md) | Phase 6 credentials — the only thing blocking a phase |
> | [ISSUE-022](ISSUES.md) | Three identifiers in a now-public repo; all judged safe, your call to revisit |
> | [ISSUE-024](ISSUES.md) | Timestamp-collision truncation; logged, not fixed, structural |
> | [ISSUE-015](ISSUES.md) | `verify:admin` and `verify:security` mutate shared state — do not run them while someone is using the app |
> | [ISSUE-004](ISSUES.md) / [ISSUE-005](ISSUES.md) / [ISSUE-006](ISSUES.md) | No Docker: hand-maintained types, remote migrations, unfixable transitive advisories |
>
> ---


Single source of truth for build status. Update immediately after any phase work.

**Status legend:** `Not Started` · `In Progress` · `Done` (built, self-checked) · `Verified` (lint + type-check + build + phase acceptance criteria all pass)

## Phase status

| #   | Phase                                                                              | Status      | Completed  | Verified   |
| --- | ---------------------------------------------------------------------------------- | ----------- | ---------- | ---------- |
| 0   | Repo & docs setup                                                                  | Verified    | 2026-07-30 | 2026-07-30 |
| 1   | [Foundation — scaffold, auth, schema, RLS](../phases/PHASE-1-foundation.md)        | Verified    | 2026-07-30 | 2026-07-30 |
| 2   | [Chat interface with streaming](../phases/PHASE-2-chat-streaming.md)               | Verified    | 2026-07-30 | 2026-07-30 |
| 3   | [Provider abstraction + model selector](../phases/PHASE-3-provider-abstraction.md) | Verified    | 2026-07-30 | 2026-07-30 |
| 4   | [Admin panel — keys, models, users](../phases/PHASE-4-admin-panel.md)              | Verified    | 2026-07-30 | 2026-07-30 |
| 5   | [Theming & appearance](../phases/PHASE-5-theming.md)                               | Done        | 2026-07-31 | —          |
| 6   | [R2 uploads + Resend emails](../phases/PHASE-6-storage-email.md)                   | Partial     | 2026-07-31 | —          |
| 7   | [Analytics, audit UI, polish](../phases/PHASE-7-analytics-polish.md)               | Partial     | 2026-07-31 | —          |
| 8   | [CI/CD + Railway deployment](../phases/PHASE-8-cicd-deploy.md)                     | Done        | 2026-07-31 | —          |

## Deployed

Live at **https://myaichat-production.up.railway.app** (Railway, US West), auto-deploying from `main`.
Verified in production 2026-07-30: health endpoint green, and the gates, chat, providers and admin
suites all pass against the live URL — not just localhost.

Deployment was pulled forward from Phase 8 at the user's request. Since 2026-07-31 a GitHub
Actions pipeline runs lint, type-check, format, build and the credential-free verification
suites on every push and pull request. Railway still deploys from `main` on its own — CI and
the deploy are not yet chained, so a red build does not *block* a deploy, it only reports one.
Closing that gap needs branch protection, which needs a paid plan on a private repo (ISSUE-018).

## Verification checklist (per phase)

A phase moves to **Verified** only when all four pass:

- [ ] `npm run lint`
- [ ] `npm run type-check`
- [ ] `npm run build`
- [ ] Every acceptance criterion in the phase file

---

## Phase 0 — Repo & docs setup · Verified · 2026-07-30

**Built**

- Git repo initialized, pushed to `github.com/MyChat99/myaichat` (private, default branch `main`)
- `.gitignore` covering secrets (`.env`, `*.pem`, `*.key`), Node, Python, editor files, macOS
- Docs restructured to match the paths CLAUDE.md declares: `CLAUDE.md` at repo root, spec at `docs/00-PROJECT-SPEC.md`, the 8 phase files under `docs/phases/`
- Project wiki created at `docs/wiki/` (this file, ISSUES, DECISIONS, ROADMAP)
- `## Project wiki (mandatory)` section added to CLAUDE.md

**Verification**

- Structure confirmed against CLAUDE.md's stated layout — spec `@docs/00-PROJECT-SPEC.md` and `docs/phases/` references now resolve
- Lint / type-check / build: N/A — no application code or `package.json` yet

**Notes**

- No application code exists. Phase 1 starts from an empty scaffold.

---

## Phase 1 — Foundation · Verified · 2026-07-30

**Built**

- Next.js 16.2.12 App Router, TypeScript strict, Tailwind v4, ESLint, Prettier, shadcn/ui (`base-nova`, CSS variables), Framer Motion, Lucide, Zod, sonner
- Directory layout per CLAUDE.md: `/app`, `/components`, `/lib/{db,security,providers,r2}`, `/emails`, `/scripts`, `/supabase`
- Four migrations covering all 9 spec tables, 2 enums, 9 indexes, `updated_at` triggers, RLS on every table, `is_admin()`, `handle_new_user()`, `providers_public`
- Three Supabase clients — browser, cookie-bound server, and a `server-only` admin client using the secret key
- Email/password auth: signup, login, signout, `/auth/confirm` for emailed links; session refresh in `proxy.ts`
- Protected `(app)` shell with header, chat placeholder, role-gated `/admin` placeholder
- `.env.example` covering every variable through Phase 8; idempotent seed script
- Three verification scripts committed as evidence: `verify:schema`, `verify:rls`, `verify:gates`

**Verification**

| Criterion | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run type-check` | pass |
| `npm run build` | pass — 6 routes |
| Migrations apply cleanly | pass — 4 migrations pushed to the hosted project; `verify:schema` confirms all 9 tables, the view, and `is_admin()` |
| RLS: user A cannot query user B | pass — `verify:rls`, 23 checks |
| Non-admin visiting /admin is redirected | pass — `verify:gates`, 7 checks over real HTTP, incl. admin-reaches-`/admin` as a control |
| Sign up → login → authenticated shell | pass — browser walkthrough on 2026-07-30: login → Welcome shell → /admin → sign out |
| Seed creates the admin + settings | pass — `verify:seed`; idempotent across 4 consecutive runs |

**Deviations from the phase file**

- `supabase db reset` was not run. It is Docker-only locally, and `--linked` would destroy the hosted database. Migrations were validated with `db push` from zero instead, which covers the same ground on an empty project. See [ISSUE-004](ISSUES.md).
- `middleware.ts` is `proxy.ts` — Next 16 renamed the convention and warns on the old name.
- `lib/db/types.ts` is hand-written; `supabase gen types` needs Docker. See [ISSUE-005](ISSUES.md).
- Provider secrets use column-level grants rather than RLS, which cannot hide a column. See [DEC-005](DECISIONS.md).

**Bugs found and fixed during the phase**

- [ISSUE-007](ISSUES.md) — recursive `profiles` UPDATE policy (`42P17`) broke every profile edit. Fixed in migration `20260730120004`.
- [ISSUE-008](ISSUES.md) — seed crashed on a null-valued `system_settings` row, leaving the database half-seeded. Fixed and made provably idempotent.
- [ISSUE-009](ISSUES.md) — `shadcn init` emitted a self-referential `--font-sans`, so every surface rendered in the browser's default serif instead of Geist. Caught by eye in the browser walkthrough, not by any automated check.

**Known cosmetic gaps** (deliberately not addressed in Phase 1)

- The shell is unstyled placeholder UI. Design work belongs to Phases 2, 5 and 7.

---

## Phase 2 — Chat interface with streaming · Verified · 2026-07-30

**Built**

- `/api/chat` route handler: authenticates, validates with Zod, rate-limits per user, streams from Anthropic and relays NDJSON. The provider key is read only inside a `server-only` module and never crosses to the client.
- `lib/providers/` — a `ChatProvider` interface plus the Anthropic adapter, already shaped so Phase 3 adds an adapter file rather than rewriting the route
- Persistence: both turns saved, token counts recorded, `usage_logs` written with estimated cost, conversation auto-titled from the first message
- UI: sidebar (create, rename, delete, pin, search, collapsible on mobile), thread view, auto-growing composer with Enter / Shift+Enter, typing indicator, scroll-to-bottom pill, 4 starter prompts, toast error states
- Message actions: copy, regenerate, edit-and-resubmit — the last two rewind the thread server-side via `truncateFromMessageId`
- Stop aborts the upstream request server-side; whatever was generated is kept rather than discarded
- Markdown rendered with `rehypeSanitize` **before** `rehypeHighlight`, so only markup we generate survives

**Verification** — `npm run verify:chat`, 25 checks

| Criterion | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run type-check` | pass |
| `npm run build` | pass — 8 routes |
| Full streamed conversation | pass |
| Refresh restores history from the DB | pass — both turns persisted, content matches the stream byte for byte |
| XSS attempt renders inert | pass — script tags, inline handlers and `javascript:` URLs all stripped from the real component |
| Code blocks highlight | pass — `hljs` classes survive sanitization |
| Code blocks **copy** | pass — browser walkthrough 2026-07-30 |
| Stop halts generation immediately | pass — automated check asserts the persisted partial is short, i.e. the server stopped rather than finishing in the background; confirmed by hand too |
| Regenerate / edit-and-resubmit | pass |
| Responsive / mobile sidebar | pass — browser walkthrough 2026-07-30 |

**Deviations from the phase file**

- Provider is Anthropic as specified, but the model is `claude-opus-5` with thinking explicitly disabled ([DEC-008](DECISIONS.md)).
- Streaming uses NDJSON rather than SSE ([DEC-009](DECISIONS.md)).
- History is capped at the last 40 messages per request — dropped, not summarised. Compaction is a later concern.

**Bugs found and fixed during the phase**

- [ISSUE-011](ISSUES.md) — the proxy redirected unauthenticated API calls to the HTML login page, so `POST /api/chat` returned 200 and the handler's own 401 was unreachable.

**Carried into Phase 3** — done: the selected model's display name is now passed into the system prompt, so "which model are you?" is answerable.

---

## Phase 3 — Provider abstraction + model selector · Verified · 2026-07-30

**Built**

- `ChatProvider` interface with `streamChat()`, `listModels()`, `validateKey()`, plus a normalised `ProviderError` taxonomy (`auth`, `quota`, `rate_limit`, `context_length`, `network`, `provider`, `unknown`) the UI reacts to instead of vendor status codes
- Anthropic and OpenAI adapters, each the only file in the codebase that knows its vendor's API
- Registry mapping `providers`/`models` rows to adapters; `/api/chat` names no vendor and imports no vendor SDK
- Model selector in the chat header, grouped by provider, persisted to the conversation. Switching mid-conversation applies to subsequent messages.
- The selected model's display name is passed into the system prompt
- [lib/providers/README.md](../../lib/providers/README.md) documenting the add-a-provider path and the vendor differences the abstraction absorbs

**Verification** — `npm run verify:providers`, 20 checks

| Criterion | Result |
| --- | --- |
| `npm run lint` / `type-check` / `build` | pass |
| Same UX against both providers | pass — the same conversation flow streams from Anthropic and OpenAI |
| Switching models works | pass — automated at the API level, and confirmed in the browser 2026-07-30: switched Claude → GPT mid-conversation and the reply came from the new model |
| Third provider = one adapter file + DB rows | pass — enforced by `git grep`: no vendor SDK import and no provider name outside `lib/providers`. A passing two-provider chat does not prove this; an if/else in the route would pass that too. |
| `usage_logs` with correct token counts | pass — per provider, attributed to the right model, including after a mid-conversation switch |
| `/lib/providers/README.md` documents it | pass |

**Deviations from the phase file**

- Provider marks are lettermark badges, not vendor logos ([DEC-010](DECISIONS.md)).
- `listModels()` is implemented and tested but not yet wired to admin UI — model management is Phase 4's scope.

**Bugs found and fixed during the phase**

- [ISSUE-012](ISSUES.md) — the first OpenAI key authenticated but had no credit. Led to [DEC-011](DECISIONS.md): `validateKey()` must spend a token, never just list models.
- A 1-token validation probe failed on a healthy OpenAI key — OpenAI errors where Anthropic truncates. Documented in the provider README.

**Ready for Phase 4** — done: keys are now encrypted in the database and adapters take them by injection.

---

## Phase 4 — Admin panel · Verified · 2026-07-30

**Built**

- AES-256-GCM in `lib/security/crypto.ts`. Format `v1.<iv>.<tag>.<ciphertext>`, fresh random IV per encryption, authenticated so tampering throws rather than returning junk. The version prefix leaves room to rotate algorithms without a flag day.
- Adapters are now factories taking an API key; the registry resolves it from `providers.encrypted_api_key` and decrypts at call time, with an env-var fallback for a fresh local checkout. `getClient()` no longer reads `process.env`.
- `npm run keys:encrypt` moved both live keys into the encrypted column.
- Admin shell with Providers / Models / Users / Settings. Providers: masked key, rotate, delete, enable-disable, Test Connection with latency. Models: full CRUD plus "Fetch from provider". Users: search, promote/demote, suspend/activate. Settings: default model, global prompt, rate limit, upload cap, sign-ups.
- Audit logging on every mutation — actor, action, target, metadata, IP — written with the admin client because `audit_logs` has no client-facing insert policy. `redactMetadata()` is a backstop against a key ever reaching the trail.
- Suspension enforced in RLS as well as the route ([DEC-012](DECISIONS.md)), with a banner in the app shell.

**Verification** — `npm run verify:admin`, 40 checks

| Criterion | Result |
| --- | --- |
| `npm run lint` / `type-check` / `build` | pass |
| Keys never in plaintext in DB, client, or logs; masked in UI | pass — stored values are `v1.…` ciphertext, decrypt to real keys, only `key_last4` is clear. Round-trip, IV-uniqueness and tamper-rejection all asserted. |
| Test Connection distinguishes valid from invalid | pass — delegates to `validateKey()`, which generates rather than lists ([DEC-011](DECISIONS.md)) |
| Chat uses DB-stored encrypted keys | pass — proved by **breaking only the database value** and confirming chat fails. Had it kept working, that would have exposed a silent env-var fallback. |
| Disabling a provider hides its models | pass — model list shrinks and excludes that provider, then restores |
| Non-admins blocked from every /admin route | pass — all 5 routes × anon / non-admin / admin |
| …and from admin mutations | pass — structurally: every exported action calls `requireAdmin()`. Mutations are Server Actions, so CSRF is the framework's Origin check ([DEC-013](DECISIONS.md)). |
| Every admin action appears in audit_logs | pass — structurally asserted, and exercised in the browser walkthrough 2026-07-30 (Test Connection, provider toggle, settings save) |

**Deviations from the phase file**

- "Add provider" is not a UI affordance: a provider without a registered adapter cannot work, so providers come from the seed catalogue and the registry. The page names any adapter missing a database row.
- "Fetch from provider" lists the live catalogue rather than auto-inserting rows — the provider reports no cost or context data, and inserting models with zero costs would quietly corrupt the usage estimates.

**Bugs found and fixed during the phase**

- [ISSUE-013](ISSUES.md) — `lib/db/types.ts` drifted from the schema the moment a column was added, exactly as ISSUE-005 predicted. Caught by type-check.
- `verify:gates` broke when `/admin` became a redirecting index. The assertion now distinguishes an admin being forwarded *deeper into* admin from a non-admin being bounced *out of* it — the sloppy fix (accept any 307) would have made the test useless.

**Browser walkthrough** — 2026-07-30: Test Connection green on both providers, toggling a provider removed its models from the chat selector, and a settings change persisted across a reload.

---

## Phase 5 — Theming & appearance · Done · 2026-07-31

**NEEDS HUMAN VERIFICATION** — two criteria cannot be asserted without eyes on a
browser. Everything else is automated and passing.

**Built**

- Seven preset themes (Default, Midnight, Ocean, Forest, Sunset, Rose, Mono) as typed data in `lib/theme/presets.ts`, each with light and dark token sets. Adding a theme is one object — the CSS is generated, the contrast test picks it up, and the picker lists it with no other edits.
- Zero-flash application: both modes are emitted server-side and the resolved class is in the initial HTML. Only `system` needs the pre-paint inline script, which also follows OS changes mid-session.
- Appearance panel at `/settings` — mode, theme, eight accent swatches plus custom hex, three text sizes, Bubbles/Document message style, and a live preview that writes the *same generated CSS the server emits*.
- Custom accents derive a readable foreground automatically, with a live contrast ratio shown; a colour below AA says so rather than silently shipping unreadable buttons.
- No hardcoded colours left in components. Provider brand colours moved to `lib/theme/brand.ts` as data (deliberately not themeable); success states became a token; syntax highlighting derives from theme variables.
- `prefers-reduced-motion` honoured globally; the cross-fade transitions only colour properties.

**Verification**

| Criterion | Result |
| --- | --- |
| `npm run lint` / `type-check` / `build` | pass |
| All themes pass AA contrast | pass — `verify:theme`, **134 pairings** across 7 themes × 2 modes, including muted text and both semantic colours |
| Preferences persist across refresh and devices | pass — `verify:appearance`, 15 checks; a second request is a different device to the server |
| No flash of wrong theme | pass **for explicit light/dark** — asserted by finding the theme in the server-rendered HTML. `system` mode resolves in a pre-paint script; **NEEDS HUMAN VERIFICATION** that no flash is perceptible. |
| Smooth animated cross-fade | **NEEDS HUMAN VERIFICATION** — motion cannot be asserted headlessly |
| Six preset themes minimum | pass — seven |
| No hardcoded colours remain | pass — grep finds none outside the brand data file |

**Deviations from the phase file**

- The phase file's token names (`background`, `surface`, `accent`, …) are the authoring vocabulary in `presets.ts`, but they are *emitted* as the shadcn variable names the app already used. This was the smallest possible change to working Phase 1–4 code — no component had to be edited to become themeable. ⚠️ Note the collision: shadcn's `--accent` is a hover surface, so the brand accent maps to `--primary`.
- Semantic colours (`destructive`, `success`) are intentionally consistent across themes. A green that turns orange in one theme stops reading as "success".

**To reach Verified**

Open `/settings`, switch themes and modes, and confirm: no flash on reload (especially with the OS set to dark and mode set to System), and that the cross-fade looks smooth rather than janky.

---

## Phase 6 — R2 uploads + Resend emails · Partial · 2026-07-31

**BLOCKED ON CREDENTIALS.** R2 and Resend are unconfigured ([ISSUE-016](ISSUES.md),
[ISSUE-017](ISSUES.md)), so the happy paths are unverified. Everything up to the
integration point is built and tested.

**Built and verified**

- `lib/r2/storage.ts` — presigned upload/download against a private bucket. Object keys are namespaced by user id, making ownership a string comparison and preventing a leaked key from being walked to another user's files.
- `/api/uploads/presign` validates auth → suspension → rate limit → MIME allow-list → size, and only then touches storage. Every rejection is testable without credentials.
- `/api/uploads/download` returns a 302 to a short-lived presigned GET, after an ownership check that 404s (not 403s) on someone else's key — a 403 confirms the file exists.
- Attachments through the provider abstraction: `ChatAttachment` is optional on `ChatMessage`, so no existing call site changed. Anthropic gets content blocks, OpenAI gets `image_url` parts.
- Model capabilities (`supports_vision`, `supports_documents`) live in the database. A model that cannot read an image returns **422 with a clear message** rather than dropping the file and answering as though it had seen it.
- Four React Email templates with dark-mode support, inline styles, and every action link repeated as copyable text.
- Profile page: display name and avatar upload, avatars served through our route rather than a bucket URL.

| Criterion | Result |
| --- | --- |
| `lint` / `type-check` / `build` | pass |
| Unauthorised / oversized / wrong-type uploads rejected server-side | pass — `verify:storage`, 16 checks |
| Direct bucket URLs do not work | pass **by construction** — no code path returns a public URL, and downloads go through an ownership-checked route. **NEEDS HUMAN VERIFICATION** that the bucket itself is created private. |
| Upload → send → model receives the attachment | **NEEDS CREDENTIALS** — cannot be exercised without R2 |
| All four emails render well in light and dark clients | pass for *structure* — `verify:email`, 23 checks (dark-mode styles, inline CSS, no stranded white text). **NEEDS HUMAN VERIFICATION** of actual rendering in Gmail/Outlook. |
| All four emails send | **NEEDS CREDENTIALS** — console transport only |

**Not done**

- **Composer attachment UX** (task 2): the upload helper and API exist, but the attach button, drag-and-drop and chip previews are NOT wired into the chat composer. Deliberate — building an attachment UI that cannot upload anything would be unverifiable, and I would rather leave it clearly missing than half-present. This is the first thing to finish once R2 credentials exist.
- **Supabase auth emails routed through Resend** (task 7): a dashboard SMTP change, not code. See ISSUE-017.

---

## Phase 7 — Analytics, audit UI, polish · Partial · 2026-07-31

Three of eight tasks done to completion. The rest were **deliberately not
started** rather than half-built — see below.

**Built and verified**

- **Analytics** (`/admin/analytics`): messages per day, tokens by model, cost by provider, active users; 7/30/90-day ranges. Aggregated server-side — sending 10k raw rows to the browser to group them is precisely what makes such dashboards collapse as data grows. A 50,000-row ceiling bounds memory and the page *says so* when hit rather than silently showing a subset.
- **Audit log** (`/admin/audit`): filterable by action, paginated, actor emails resolved in one round trip.
- **Security headers** (task 6): CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy — all confirmed present over HTTP.

| Criterion | Result |
| --- | --- |
| `lint` / `type-check` / `build` | pass |
| Dashboards render real data | pass — charts read live `usage_logs` |
| …and stay fast with 10k+ rows | **NEEDS HUMAN VERIFICATION** — the aggregation is server-side and bounded, but there are only ~40 usage rows in this database, so the claim is architectural rather than measured |
| Keyboard-only operation end to end | **NOT VERIFIED** — needs a human at a keyboard |
| Lighthouse ≥90 perf / ≥95 a11y | **NOT MEASURED** — needs a browser |

**Not started (deliberately)**

- Task 3 (Framer Motion animation pass), task 4 (command palette + shortcuts modal), task 5 (error boundaries — toasts already exist from Phase 2), task 7 (performance pass), task 8 (accessibility audit).
- These are the diffuse, visual tasks. Their acceptance criteria are Lighthouse scores and a keyboard walkthrough, neither of which I can measure headlessly — so building them tonight would have produced code I could not verify and you could not trust. `prefers-reduced-motion` and the theme cross-fade landed in Phase 5, so the accessibility floor for motion is already in place.

**Note on CSP**

`script-src` includes `'unsafe-inline'`. This is not laziness: the pre-paint theme
resolver in `app/layout.tsx` is an inline script, and a nonce cannot be applied to
it without reintroducing the flash Phase 5 exists to eliminate. The trade is
documented at the top of `next.config.ts`. Removing it would require moving theme
resolution to a cookie read in `proxy.ts` — possible, and worth doing if CSP
strictness ever matters more than the flash.

---

## Session 2 — Priority 1 & 2 · 2026-07-31

Overnight work, additive only. Nothing in Phases 1–4 was modified.

### Priority 1 — Phase 8 groundwork · Done

- **CI pipeline** (`.github/workflows/ci.yml`): three jobs. `quality` runs lint,
  type-check, format:check and build **with no secrets present** — which also
  proves the lazy-env fix from ISSUE-014 holds, since a build that needed runtime
  credentials would fail here. `tests` runs only the credential-free suites.
  `security` runs the audit non-blocking.
- **Railway deploy job is present but DISABLED** (`if: false`), by instruction and
  because Railway already auto-deploys from GitHub — enabling both would race two
  deploys against one another. The comment in the file lists the exact three steps
  to switch over.
- **`/api/health`**: already existed from the deployment work; now exercised by CI.
- **`SECURITY.md`**: security model, the four authorisation layers, and incident
  checklists for a leaked provider key, a leaked master key, a compromised account
  and an exposed database.
- **`README.md`**: setup, scripts, architecture summary.
- **`.github/dependabot.yml`**: weekly npm updates grouped production/development,
  monthly Actions. Majors for `next`/`react`/`react-dom` arrive individually rather
  than inside a group, so a framework major is never buried in a batch.
- **`scripts/security-audit.ts`** (`npm run security:audit`): secret-shape grep over
  tracked files, `npm audit` parsing, and an RLS check that reads the **pg catalog**
  through a new `rls_status()` function rather than trusting that migrations ran.

**NEEDS HUMAN VERIFICATION**

- Branch protection could not be enabled — GitHub returns 403 for rulesets on a
  private repo without a paid plan (ISSUE-018). Three options are written up there;
  the decision is yours.
- Two Dependabot PRs (#5 typescript 7, #6 eslint 10) fail CI for a real upstream
  reason, not a flake — `eslint-config-next` bundles a react plugin incompatible
  with ESLint 10. Recommendation: close both (ISSUE-019).

### Priority 2 — Interface polish · Done, visually unverified

- **Motion primitives** (`components/motion/motion.tsx`): message entrance, overlay
  and panel variants, press feedback. Every one consults `useReducedMotion()`, and
  when it is on the duration collapses to **zero**, not merely shorter — a fast
  animation is still animation, and that setting exists for people for whom that is
  the problem.
- **Command palette** (`Cmd/Ctrl+K`) with new chat, appearance, profile, model
  switching and conversation search; `?` opens a shortcuts modal. Written without
  `cmdk` on purpose: the surface is one filtered list, and the focus-trap and
  focus-restore behaviour is the actual work — worth owning rather than inheriting.
  `?` is ignored while typing, or a question mark could never be typed anywhere.
- **Error boundaries**: `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`
  and a shared `ErrorState`. The boundary never renders `error.message` — in
  production Next replaces it with a digest anyway, and in development it carries
  internals no user should read — but it *does* show the digest, which is the string
  that makes a support report traceable to a server log. `global-error.tsx` uses
  inline styles and a neutral palette because the layout that defines the theme
  tokens is precisely what has failed by the time it renders.
- **Security headers hardened** (`next.config.ts`), **CSP deliberately untouched** —
  that decision is the owner's. Added: `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`, `X-DNS-Prefetch-Control: off`, a
  twelve-feature `Permissions-Policy` deny list, and `Cache-Control: no-store` on
  `/api/*`. `Cross-Origin-Embedder-Policy` was **not** added: `require-corp` would
  demand CORP headers from every third-party resource, which Supabase-hosted avatars
  do not send, so it would break images to buy isolation this app does not need.
- **`npm run verify:headers`** (24 checks) asserts all of the above against
  `next.config.ts` and runs in CI. It reports the `unsafe-inline` exception as a note
  rather than a failure, so the known trade stays visible without going red.

| Criterion | Result |
| --- | --- |
| `lint` / `type-check` / `build` | pass |
| `verify:headers` | pass — 24/24 |
| `verify:theme` / `appearance` / `gates` / `rls` / `providers` / `admin` | pass |
| Palette opens on ⌘K, arrows and Enter work | **Verified** 2026-07-31 by owner |
| Animations feel right, and stop under reduced motion | **Verified** 2026-07-31 by owner |
| Error and 404 pages look correct | **Verified** 2026-07-31 by owner |

### Priority 3 — Security hardening · Done & verified

- **Login throttling** — new `auth_attempts` table (migration `20260731130001`),
  five failures per account or thirty per IP in fifteen minutes. Two counters,
  because a per-account limit never trips under password spraying and a per-IP
  limit alone punishes shared networks. Stored identifiers are HMACed so the
  table is not an email list. See DEC-013.
- **Signup hardening** — 10-character minimum, a common/repetitive/email-derived
  password blocklist, and a disposable-domain blocklist. Composition rules were
  deliberately not added; see DEC-014, including why the *login* path keeps the
  old 8-character minimum (raising it there locks existing users out of their
  own accounts at form validation).
- **Re-authentication for provider key changes** — `setProviderKey` and
  `deleteProviderKey` now require the admin's password, verified server-side on
  a throwaway client and throttled under its own counter. See DEC-012.
- **Per-user daily token budget** — `system_settings.daily_token_budget_per_user`
  (0 = unlimited, the default), enforced in `/api/chat` from `usage_logs` since
  00:00 UTC, and editable in `/admin/settings`. It sits beside the hourly message
  limit rather than replacing it: one is a pace limit, the other a spend ceiling,
  and sixty messages an hour of very large context is a bill the message counter
  never sees.
- **`npm run verify:security`** — 35 checks across all four. Excluded from CI for
  the ISSUE-015 reason: it temporarily writes a system setting and restores it in
  `finally`, and there is one Supabase project behind local and production.

| Criterion | Result |
| --- | --- |
| `lint` / `type-check` / `build` | pass |
| `verify:security` | pass — 35/35 |
| `security:audit` | pass — all **10** public tables have RLS |
| Throttle blocks after 5 failures, clears on success | pass — asserted against stored rows |
| `auth_attempts` unreadable with the publishable key | pass |
| Over-budget user is refused by the chat route | pass — asserted via `checkDailyTokenBudget` on a real user with real usage |
| The password prompt appears when rotating a key | **Verified** 2026-07-31 by owner — wrong password rejected, correct password accepted |

### Priority 4 — Frontend polish · Done, visually unverified

- **Message list windowing** — the list mounts the most recent 60 messages with
  a "Show N earlier messages" control, and rows more than six from the bottom
  carry `content-visibility: auto` so the browser skips their layout and paint.
  A real virtualiser was **rejected**: react-window and friends position rows
  absolutely from measured heights, which fights markdown rows of unknown height
  and a final row that grows on every streamed token. The failure mode there is
  a scroll position that jumps mid-response — worse than the problem being
  solved. Windowing gets the same bounded DOM with none of that risk.
- **Loading skeletons** — `loading.tsx` for the conversation, admin, settings and
  profile routes, shaped like the content they replace so nothing jolts when the
  real markup lands. Each sits in a `role="status"` live region, so a screen
  reader hears "loading" rather than a wall of empty boxes.
- **Favicon and OG metadata** — `app/icon.svg`, a generated `favicon.ico` and
  `apple-icon.png` (replacing the create-next-app defaults), plus a generated
  `opengraph-image` and full Open Graph / Twitter metadata. `metadataBase` is set,
  without which Next emits **relative** og:image URLs that no crawler resolves —
  the card would have silently never appeared. `robots: noindex` because a
  private chat app has nothing to gain from being indexed.
- **Title template fixed** — adding `template: '%s · myaichat'` would have turned
  every existing page title into "Profile · myaichat · myaichat"; all six page
  titles were shortened in the same change.
- **Mobile** — the header nav now wraps instead of overflowing (at 360px the four
  links plus the sign-out button do not fit on one line, and an overflowing
  header puts a horizontal scrollbar on the whole page). The sidebar drawer,
  admin tab strip and audit table already had mobile handling from earlier phases.
- **Profile** — an Account card showing email, role, member-since and status.
  The date is formatted with a fixed locale and UTC, because a server-rendered
  date that follows the server's locale is a hydration mismatch waiting to happen.

| Criterion | Result |
| --- | --- |
| `lint` / `type-check` / `build` | pass |
| `verify:theme` / `verify:appearance` | pass |
| Icons render correctly | pass — generated PNG inspected directly |
| OG card renders | **NEEDS HUMAN VERIFICATION** — route builds; the image itself is unseen |
| Skeletons match the real layout | **NEEDS HUMAN VERIFICATION** |
| Mobile layout at 360px | **Verified** 2026-07-31 by owner — header wraps, no horizontal scroll |
| Windowing at 60+ messages | **NEEDS HUMAN VERIFICATION** — no conversation here is that long |

### Priority 5 — Test depth · Done

- **`npm run verify:authz`** (36 checks) — a *completeness* check, and that is
  the point. Every runtime suite proves the endpoints it knows about are gated;
  none can notice a **new** Server Action shipped without one, because a test
  only covers what someone remembered to write. This walks the source: every
  exported action, every route handler, every admin page. Public routes need a
  written reason to be exempt. Runs credential-free in CI.
  - Writing it surfaced two ways a naive version lies: a return type of
    `Promise<{ ok: true }>` makes brace-matching stop at the *type's* brace, so
    a well-gated action reads as ungated; and a gate reached through a local
    helper (`createConversation` → `insertConversation` → `requireUser`) is a
    real gate. Both are handled, and both produced false failures first.
- **Rate limit and token budget** now covered in `verify:security` (42 checks):
  exact message counting, assistant replies correctly *not* counted, the cutoff
  at the configured limit, and the budget refusal for a user with real usage.
  Both temporarily change a system setting and restore it in `finally`.
- **`npm run smoke`** — 18 checks against a *running* server, which is a
  different question from everything else in `scripts/`. It found a real bug on
  its first run: `/opengraph-image` was being redirected to `/login` by the
  proxy, so no link-preview crawler — all of which are anonymous — could ever
  have fetched the card. Fixed in `lib/db/session.ts`.
- **`verify:providers` exemption** — the password blocklist contains 'anthropic'
  and 'openai', which the no-vendor-names scan flagged. Exempted as one named
  file with a reason, not a pattern: a string table is not a branch on vendor.

| Criterion | Result |
| --- | --- |
| `verify:authz` | pass — 36/36 |
| `verify:security` | pass — 42/42 |
| `smoke` (local production build) | pass — 18/18 |
| `verify:gates` / `rls` / `appearance` / `providers` / `admin` / `theme` / `headers` | pass |
| `smoke` against the live Railway URL | **NOT RUN** — the standing instruction was not to touch production tonight. Run `npm run smoke -- --url https://myaichat-production.up.railway.app` when you are ready; it is read-only and sends no chat message. |

### Priority 6 — Documentation · Done

- **`docs/ARCHITECTURE.md`** — system diagram, chat and sign-in sequence
  diagrams, an ER diagram, the authorisation-layer chain and the secret
  lifecycle, all in Mermaid so they render on GitHub without an image to keep in
  step. Written to explain the non-obvious decisions rather than restate the file
  tree: why NDJSON instead of SSE, why a foreign conversation 404s instead of
  403s, why the user message is written before the provider call, why adapters
  are factories rather than singletons.
- **`lib/providers/README.md`** — rewritten as five concrete steps. The previous
  version documented a shape the code no longer has (a `ChatProvider` singleton;
  adapters have been key-taking factories since Phase 3), which is worse than no
  document — someone following it would have written an adapter that closes over
  a key that rotation then invalidates.

---

## Away session — Priority 2 · Phase 6 attachment UI · 2026-07-31

Phase 6's one unfinished task (composer attachment UX) is now built. It is
**fully wired against the real presign route** — the only step that cannot run
is the PUT to R2, which needs credentials.

- **`components/chat/attachments.tsx`** — file picker, drag-and-drop with a
  drop overlay, **paste-to-attach** (screenshots arrive on the clipboard far
  more often than through a picker), image thumbnails from object URLs,
  per-file progress and per-file errors, remove-before-send.
- **The paperclip is disabled with a reason** when storage is unconfigured,
  rather than failing on click. `isStorageConfigured()` is read server-side and
  passed down — the client cannot determine this for itself.
- **One accepted-type table** (`lib/upload/types.ts`) imported by both the
  composer and the server-only storage module. Previously the list lived behind
  `server-only`, so a client copy would have been the only option — and two
  copies drift into the worst failure mode there is: the picker accepts a file,
  the upload starts, and the server rejects it with an error the user cannot act
  on.
- **Uploads are concurrent and fail individually.** A failed chip stays on
  screen in an error state; removing it silently would look like it attached.
- **Send is blocked while any upload is in flight**, and a message with an
  attachment but no text is valid — "what is this?" is implied by the picture.
- **`npm run verify:attachments`** — 33 credential-free checks, wired into CI.
  Covers every rejection path (executables, SVG, HTML, zips, video, empty files,
  oversized, missing MIME), the wording of each message, and two contract
  assertions: that the per-message cap matches the chat route's `.max(5)`, and
  that SVG and HTML are absent from the allow-list. An SVG is an image to a user
  and a script host to a browser; serving one from our own origin is stored XSS.

**`docs/wiki/PHASE-6-CHECKLIST.md`** is the sequence for when credentials land:
exact env var names, the R2 bucket settings that must be verified by a human
(public access **off**, CORS including `content-type`), the Resend test-mode
trap that makes your own emails arrive and everyone else's silently not, and the
verification order. Nothing in it requires a code change.

| Criterion | Result |
| --- | --- |
| `lint` / `type-check` / `build` | pass |
| `verify:attachments` | pass — 33/33 |
| `verify:storage` | pass — rejection paths hold |
| Picker, drag-drop, paste, remove all behave | **NEEDS HUMAN VERIFICATION** — no credentials, so no upload completes |
| The PUT to R2 | **BLOCKED** — ISSUE-016, awaiting credentials |

## Away session — Priority 3 · Adversarial self-review · 2026-07-31

Read Phases 1–7 as a hostile reviewer looking for authorisation gaps,
unvalidated input, races, missing RLS, leaky errors and dead code.

**One high-severity bug found and fixed — [ISSUE-023](ISSUES.md).** The chat
route sent the model the **oldest** forty messages rather than the newest, so
past forty turns it never saw the question just asked. Nothing errored; the only
symptom was an assistant that appeared to lose the thread on long conversations,
which reads as a model limitation rather than our bug. The longest conversation
here is 31 messages, so it had not surfaced yet.

**One structural issue logged, not fixed — [ISSUE-024](ISSUES.md).** Truncation
deletes by `created_at >=`, and `now()` is transaction time, so colliding
timestamps would over-delete. The correct fix is a sequence column plus a
migration and changes to every read path that assumes `created_at` ordering —
structural, so logged per the standing instruction.

**Checked and found sound:** `keyBelongsToUser` prefix matching (fixed-length
UUIDs plus a trailing slash, so no prefix confusion); self-demotion and
self-suspension guards on the admin actions; the 404-not-403 choice on foreign
resources; every mutation running through the RLS-bound client rather than the
admin client; error responses carrying no internals.

**`npm run verify:api` — 47 checks, refusals only.** Every route now has tests
proving it rejects: no session, malformed body, out-of-schema values, another
user's resource. Two assertions carry more weight than the rest:

- **Status *and* content type.** ISSUE-011 was an unauthenticated POST returning
  200 with an HTML login page — a test checking only "not 2xx" would have passed
  it, and one checking only status would have missed JSON callers getting HTML.
- **A foreign conversation is byte-identical to a missing one.** Otherwise the
  difference between 403 and 404 is an existence oracle.

| Criterion | Result |
| --- | --- |
| `verify:api` | pass — 47/47 |
| `verify:attachments` | pass — 33/33 |
| Every API route has a rejection test | done — chat, presign, download, health |
| Every admin page refuses a non-admin | pass — all 7 |
| History-window regression is guarded | pass |

## Away session — Priority 4 · Export and demo data · 2026-07-31

- **Conversation export** — `GET /api/conversations/:id/export?format=md|json`,
  with `.md` / `.json` links in the chat header. Plain anchors rather than
  fetch-and-Blob: the browser already knows how to save a response carrying a
  `content-disposition` header, and doing it by hand means holding the whole
  export in memory first. Markdown writes "You" and the model's display name
  rather than `user`/`assistant`, because the file is read by a person and
  usually pasted somewhere else. Attachment **names** are listed but not linked
  — the bytes sit behind a signed URL that expires, so a link would be dead
  before anyone opened the file.
- **`npm run seed -- --demo`** — 52 conversations, 164 messages and 82 usage
  rows spread across 30 days, so the analytics ranges (7/30/90) actually differ
  and the charts are not three flat lines. Weekday volume varies, because a
  chart of uniform bars looks as fake as it is.
  - **Flag-gated, and refuses to run twice.** It writes fabricated usage rows,
    and a fabricated row is indistinguishable from a real one the moment it
    lands — it will be counted in spend and in every future report. Everything
    is tagged `[demo]` and `--clean-demo` removes exactly what it added.
  - Timestamps are written explicitly and spaced. A bulk insert otherwise lands
    every row on one transaction-time `now()`, which would flatten the charts
    *and* manufacture the collision described in ISSUE-024.

| Criterion | Result |
| --- | --- |
| `verify:api` | pass — 61/61, now covering export refusals **and** a real download |
| Export downloads rather than rendering | pass — asserted on `content-disposition` |
| `seed --demo` is gated and idempotent | pass — plain `seed` writes none; a second `--demo` run skips |
| Charts look right with demo data | **NEEDS HUMAN VERIFICATION** — data is in, appearance unchecked |

---

## Session pause — 2026-07-31

Closing state, for the record.

**Branch protection is live and enforcing.** `main` requires a pull request with
both blocking CI jobs green; force pushes and deletions are blocked; and
**administrators are bound**, which is what makes it enforcement rather than
decoration on a single-maintainer repository. Proven in both directions — a
direct push is rejected with `GH006`, and PR #7 merged cleanly through the
intended path. See [ISSUE-018](ISSUES.md) and [DEC-016](DECISIONS.md).

Phase 8 moves from **Partial** to **Done**: CI runs on every push and pull
request, and now *gates* merges rather than only reporting. It is not **Verified**,
because one acceptance criterion is unmet on purpose — CI and the Railway deploy
are still unchained, so deploys are always CI-green but are not themselves
gated. That is a decision waiting on you, not an unfinished task.

**Three stale issues corrected during the pause audit**, all found by reading
rather than by any check:

- **ISSUE-010** was marked Open for a full day after it was fixed. Phase 2 shipped
  on 2026-07-30 and the log never caught up. An issue log that lags reality is
  worse than none, because the next person plans around a blocker that no longer
  exists.
- **ISSUE-003** listed Railway alongside R2 and Resend; Railway has been live
  since 2026-07-30. Rescoped to Phase 6 credentials only.
- **ISSUE-001** is resolved and now verifiable: with the repo public, the API
  confirms every commit is linked to the `MyChat99` profile.

**Nothing is in progress.** No partial work, no stash, no open branch. The resume
point is at the top of this file.

---

## Away session 3 — Priority 1 · Queue cleared · 2026-07-31

**All four Dependabot PRs merged**, each through the protected-branch flow with
CI green on its own head commit. No `--admin` bypass was used at any point; the
protection applied yesterday was left to do its job, which meant re-updating and
re-running each branch as the ones ahead of it landed.

| PR | Bump | Outcome |
| --- | --- | --- |
| #1 | `actions/setup-node` 5 → 7 | merged — v7.0.0 confirmed current major |
| #2 | `actions/checkout` 5 → 7 | merged — v7.0.1 confirmed current major |
| #4 | `@types/node` 20 → 26 | merged |
| #3 | `react` / `react-dom` → 19.2.8 | merged |

**PR #3 was failing, and not for the reason it appeared to be.** It reported a
build failure on a react bump; the actual cause was `format:check` on a file that
had nothing to do with react. Its branch had been cut from `e8d555a`, a commit
where `main` itself was red — see [ISSUE-026](ISSUES.md). Updating the branch to
current `main` turned it green with no change to the bump.

That is worth stating plainly: **`main` was red for about forty minutes during
the last away session and I reported the commit as pushed and green.** It was
pushed. It was not green. Branch protection now makes that impossible — a merge
is blocked until the required checks pass *on that exact commit* — so the fix is
already in place structurally rather than depending on me remembering.

**[ISSUE-027](ISSUES.md) written and deliberately NOT applied**: the exact steps,
tradeoffs and a recommendation for gating the Railway deploy on CI. The
recommendation is *not yet* — branch protection already closed almost all of the
gap, and the remaining cost is a production-capable token in GitHub secrets plus
a second, unproven build path.

**Open issues reviewed for code-resolvability.** Of those still open: ISSUE-003,
-016 and -017 are credentials; -004, -005 and -006 need Docker or a Next
downgrade; -015 needs a separate CI database; -022 is a decision. Only
[ISSUE-024](ISSUES.md) is genuinely code-resolvable — handled separately so the
migration lands on its own.

| Criterion | Result |
| --- | --- |
| Four PRs merged, CI green on each head SHA | pass |
| No admin bypass used | pass |
| Full suite after all bumps | pass — 17 suites, nothing regressed |
| `lint` / `type-check` / `format:check` / `build` | pass |

## Away session 3 — ISSUE-024 resolved · message sequence · 2026-07-31

The one genuinely code-resolvable open issue. Truncation for regenerate and
edit-and-resubmit deleted by `created_at >=`, and `now()` is transaction time —
so several rows written by one statement share a value and the boundary was
ambiguous. Regenerating an assistant reply could delete the question that
prompted it.

Migration `20260731140001` adds `messages.seq` (monotonic) and the truncation,
history window, title derivation, thread render and export all order by it.
`created_at` stays as the display timestamp and is no longer load-bearing for
order.

The backfill is the part worth reviewing: it orders by `(created_at, id)` rather
than letting `bigserial` number rows in physical order, because physical order
on an updated table is not insertion order — the lazy version would have quietly
reshuffled existing conversations.

| Criterion | Result |
| --- | --- |
| Migration applied and confirmed | pass |
| `verify:api` | pass — 65/65, four of them the new collision case |
| Full DB suite incl. `verify:chat` | pass — nothing regressed |
| `lint` / `type-check` / `build` | pass |

## Away session 3 — Priority 2a · Session hardening · 2026-07-31

**The finding is the headline.** Refresh-token rotation was assumed to be in
force because Supabase rotates by default. It does rotate — and it does **not**
invalidate the old token. Measured by simulating a theft: a token replayed
twenty seconds after rotation was accepted, and the legitimate session survived
untouched, so the theft leaves no trace. Filed as **[ISSUE-028](ISSUES.md)**
(High). It is a Supabase dashboard setting, so no code here can fix it — which
is exactly why it needed measuring rather than assuming.

Signing out *does* invalidate the token; that is asserted and passing. So the
exposure is bounded by the user signing out, which most people never do.

**`npm run verify:session`** — 25 checks. Reports the rotation state as a loud
warning rather than a failure, because it describes a configuration no change in
this repository can turn green, and a permanently red suite is one people stop
reading. `-- --strict` promotes it to a failure, so the moment the setting is
fixed it can be pinned there. The pure half runs credential-free in CI.

**Idle session expiry** — `system_settings.session_idle_timeout_minutes`,
**default 0 (off)**. Enforced in the proxy, and honest about its limits: it
clears our own cookie and does not revoke the Supabase refresh token, so it
shortens the window on an unlocked or shared machine and does nothing against
someone who has already copied the cookie jar.

Three decisions in it worth keeping:

- **Default off.** This code runs on the auth path, where a mistake signs out
  every user at once. Shipping it inert means the risky part only ever runs
  after a deliberate choice.
- **An absent marker is `unmarked`, never `expired`.** Otherwise enabling the
  setting would log out everyone on their next request — asserted directly.
- **The marker is HMAC-signed**, so it can be deleted but not forward-dated.
  Without that, keeping a stale session alive forever is a one-line cookie edit.
  A forward-dated marker is tested and rejected.

The setting is read through a 60-second module-scope cache and **fails open** on
any error — a database hiccup must not sign out the whole application.

| Criterion | Result |
| --- | --- |
| `verify:session` | pass — 25 checks, 2 warnings that are the finding |
| Full suite | pass — 17 suites, nothing regressed |
| Idle expiry is inert by default | pass — asserted, and the seed writes 0 |
| Refresh-token reuse detection | **NEEDS YOUR DASHBOARD** — ISSUE-028 |
| The logout redirect renders correctly | **NEEDS HUMAN VERIFICATION** — the policy is tested; the screen is not |

## Away session 3 — Priority 2c · Re-auth on privileged actions · 2026-07-31

Password confirmation extended from provider keys to the two remaining actions
that a stolen session should not be able to perform alone:

- **`setUserRole`** — the widest escalation available in one click. A new admin
  can read every provider key's last4, change models, suspend accounts, and
  promote further users.
- **`deleteModel`** — destructive and not obviously reversible: conversations
  pinned to that model fall back to the default, and its usage rows lose cost
  attribution.

Both now route through `requireAdminWithPassword()`, which verifies on a
throwaway client (so a confirmation cannot silently re-issue session cookies)
and is throttled under its own counter (so the field is not a password oracle).

**`components/admin/confirm-password.tsx`** is the shared prompt. The
provider-key form keeps its own inline fields — it works, and rewriting working
code to share a component is not a good enough reason. This exists because the
*third* bespoke copy was the point to stop.

One React detail worth recording: the dialog's state lives in an inner component
that **mounts fresh per request**, rather than an effect that clears the password
when the request changes. The effect version is `setState` inside an effect body
— a cascading render, and correctly refused by the rules-of-hooks lint.

**Completeness check, not just a behaviour check.** `verify:admin` now asserts
that every privileged action takes a password parameter, calls
`requireAdminWithPassword`, and *returns* the failure rather than throwing —
Next replaces thrown Server Action errors with a generic message in production,
so a thrown "that password is not correct" reaches the user as "an error
occurred". A privileged action added later without re-auth fails this.

| Criterion | Result |
| --- | --- |
| `verify:admin` | pass — 13 new completeness assertions |
| Full suite | pass — nothing regressed |
| The dialog appears and rejects a wrong password | **NEEDS HUMAN VERIFICATION** — server gate tested, screen unseen |

## Away session 3 — Priority 2d · Per-endpoint rate limits · 2026-07-31

The upload routes were rate-limited by **counting their own `audit_logs` rows**.
That coupled two unrelated things: an audit trail is a permanent record, a rate
limit is a rolling window. Pruning one damaged the other, and changing what got
audited silently changed the limit. Downloads had **no limit at all**, because
nothing audited them and there was therefore nothing to count.

New `api_usage` table (migration `20260731150001`, deny-all RLS) and
`lib/security/endpoint-limit.ts`:

| Endpoint | Per minute | Per hour | Why this shape |
| --- | --- | --- | --- |
| `uploads.presign` | 20 | 120 | Each call mints a **writable credential** valid for five minutes. The size limit is per-URL, so the only thing bounding total bytes is how many URLs you can get |
| `uploads.download` | 60 | 600 | Signs a read and bills R2 egress; a gallery legitimately fetches many at once |
| `conversations.export` | 10 | 60 | Reads and serialises a whole conversation — cheap once, not in a loop |

**Two windows per endpoint, deliberately.** A single hourly cap permits emptying
the whole budget in three seconds; a single per-minute cap permits that burst
every minute all day. `verify:storage` asserts `perMinute < perHour` for every
entry, so a future endpoint cannot be added with only one of them.

Attempts are recorded **before** the work, not after. The alternative rewards
failure: a client making a thousand erroring requests would be charged for none
of them, which is exactly the shape of an abusive client.

### A flaw found in an existing check while doing this

`verify:admin` verified admin gating by reading **`git show HEAD:`** — the last
commit, not the working tree. It therefore validated the past: a missing gate
passed locally and only failed after it had already merged, which is the
opposite of what a pre-commit check is for. It also matched `requireAdmin()`
literally, so the four actions using the *stricter*
`requireAdminWithPassword()` were counted as ungated for being more careful.

Both fixed. This is why the check failed for the first time in this session
despite the change landing in the previous one.

| Criterion | Result |
| --- | --- |
| `verify:storage` | pass — 13 new limit assertions |
| `security:audit` | pass — 11 tables, `api_usage` deny-all by design |
| Full suite | pass — nothing regressed |

## Away session 3 — Priority 2e · Dependency audit as its own job · 2026-07-31

Split the dependency check out of the existing `security` job. They answer
unrelated questions — `security` checks **our** code (committed secrets, RLS
coverage), this checks a tree we mostly do not control — and merging them meant
one red badge for two problems with different answers to "is this actionable?".

**`npm run audit:report`** renders `npm audit --json` as Markdown, split into
**Direct** and **Transitive**. That split is the whole point: a transitive
advisory four levels under `next` is not something a maintainer here can fix,
and mixing it with an actionable one is what makes audit output read as noise.

Two details it surfaces that the raw summary line does not:

- **Advisory count is down from 12 to 3**, from this session's dependency bumps.
  The "12 high advisories" figure quoted in ISSUE-006 and several earlier reports
  is now stale.
- **npm's proposed fix for `next` is `next@9.3.3`** — a four-major downgrade,
  presented as a fix. The report labels any semver-major suggestion
  "check this is not a downgrade", because the failure mode here is a maintainer
  running `npm audit fix --force` and quietly reverting the framework.

The report is written to the **job summary**, not only uploaded as an artifact:
an artifact you have to download and unzip is an artifact nobody opens.

Non-blocking, and the report explains why in its own footer rather than leaving
that reasoning in a YAML comment nobody reads.

| Criterion | Result |
| --- | --- |
| `audit:report` renders | pass |
| Direct vs transitive split | pass — 1 direct, 2 transitive |
| Job runs non-blocking with a summary + artifact | **verified on the PR run** |

## Away session 3 — Priority 2b · New-login alerts for admins · 2026-07-31

An administrator signing in from a device not seen before now gets an email.
Uses the existing console transport until Resend credentials land — which is the
point: the whole flow is exercised and asserted today, and adding credentials
changes nothing but the transport.

Three deliberate scoping choices:

- **Admins only.** Theirs are the credentials worth stealing — an admin can read
  every provider key's last four, rotate keys, suspend accounts and promote
  users. Alerting every user would be noise for them and cost for us without
  making the admin account safer.
- **New devices only, not every sign-in.** Alerting on every login trains the
  recipient to delete it unread, and then the one that matters looks like the
  ninety before it.
- **The first-ever login does not alert.** There is nothing to compare against,
  so the mail would only say "you signed up".

**What is stored is an HMAC**, never the raw IP or user-agent. A table recording
where an administrator physically signs in from is a worse thing to hold than
the problem it solves, and a genuinely valuable target. Asserted directly: no
stored value contains an address or a browser name.

### The bug the test caught

The first fingerprint implementation kept the browser's **major** version —
which is exactly the digit Chrome changes every four weeks. That would have
alerted every administrator monthly about their own laptop, and an alert that
cries wolf monthly is one nobody reads on the day it matters. All version
numbers are now stripped; what survives is browser family, engine and platform.

### A design forced by a constraint, and better for it

`noteSignIn` decides and records; the **caller** sends. That split was forced —
`server-only` needs the `react-server` condition, React Email needs
`react-dom/server` which that condition removes, so a module importing both
cannot be loaded by a test at all. The result is better regardless: the policy
is testable without a mail transport, which is the part worth testing.

| Criterion | Result |
| --- | --- |
| `verify:session` | pass — 41 checks, 16 of them new |
| `security:audit` | pass — 12 tables, `known_logins` deny-all by design |
| Full suite | pass — nothing regressed |
| The email renders correctly in a client | **NEEDS HUMAN VERIFICATION** — blocked on Resend (ISSUE-017) |
