# Progress

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
| 8   | [CI/CD + Railway deployment](../phases/PHASE-8-cicd-deploy.md)                     | Partial     | 2026-07-31 | —          |

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
