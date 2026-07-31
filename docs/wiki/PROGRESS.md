# Progress

Single source of truth for build status. Update immediately after any phase work.

**Status legend:** `Not Started` · `In Progress` · `Done` (built, self-checked) · `Verified` (lint + type-check + build + phase acceptance criteria all pass)

## Phase status

| #   | Phase                                                                              | Status      | Completed  | Verified   |
| --- | ---------------------------------------------------------------------------------- | ----------- | ---------- | ---------- |
| 0   | Repo & docs setup                                                                  | Verified    | 2026-07-30 | 2026-07-30 |
| 1   | [Foundation — scaffold, auth, schema, RLS](../phases/PHASE-1-foundation.md)        | Verified    | 2026-07-30 | 2026-07-30 |
| 2   | [Chat interface with streaming](../phases/PHASE-2-chat-streaming.md)               | Done        | 2026-07-30 | —          |
| 3   | [Provider abstraction + model selector](../phases/PHASE-3-provider-abstraction.md) | Not Started | —          | —          |
| 4   | [Admin panel — keys, models, users](../phases/PHASE-4-admin-panel.md)              | Not Started | —          | —          |
| 5   | [Theming & appearance](../phases/PHASE-5-theming.md)                               | Not Started | —          | —          |
| 6   | [R2 uploads + Resend emails](../phases/PHASE-6-storage-email.md)                   | Not Started | —          | —          |
| 7   | [Analytics, audit UI, polish](../phases/PHASE-7-analytics-polish.md)               | Not Started | —          | —          |
| 8   | [CI/CD + Railway deployment](../phases/PHASE-8-cicd-deploy.md)                     | Not Started | —          | —          |

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

## Phase 2 — Chat interface with streaming · Done · 2026-07-30

Not yet **Verified** — two acceptance details need a browser, see below.

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
| Code blocks **copy** | **outstanding** — clipboard API is browser-only |
| Stop halts generation immediately | pass — asserts the persisted partial is short, i.e. the server stopped rather than finishing in the background |
| Regenerate / edit-and-resubmit | pass |
| Responsive / mobile sidebar | **outstanding** — needs a real viewport |

**Deviations from the phase file**

- Provider is Anthropic as specified, but the model is `claude-opus-5` with thinking explicitly disabled ([DEC-008](DECISIONS.md)).
- Streaming uses NDJSON rather than SSE ([DEC-009](DECISIONS.md)).
- History is capped at the last 40 messages per request — dropped, not summarised. Compaction is a later concern.

**Bugs found and fixed during the phase**

- [ISSUE-011](ISSUES.md) — the proxy redirected unauthenticated API calls to the HTML login page, so `POST /api/chat` returned 200 and the handler's own 401 was unreachable.

**To reach Verified**

Walk the browser flow once: send a message and watch it stream, reload and confirm history returns, copy a code block, press Stop mid-answer, and check the sidebar collapses on a narrow viewport.
