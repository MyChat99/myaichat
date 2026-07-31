# Decisions

Technical decisions and the reasoning behind them. **Newest entries at the top.**

Log a decision when: choosing a library not named in the spec, making an architecture tradeoff, or deviating from a phase file or the master spec.

Stack choices already fixed by [CLAUDE.md](../../CLAUDE.md) (Next.js, Supabase, Railway, Resend, R2, shadcn/ui) are **not** decisions — they are constraints. Only log a decision if you deviate from them, and say why.

## Entry format

```
### DEC-NNN — Short title
**Date:** YYYY-MM-DD | **Phase:** N | **Status:** Active | Superseded by DEC-NNN
**Decision:** What was chosen.
**Why:** The reasoning, and what was rejected.
**Tradeoff:** What this costs us.
```

---

### DEC-013 — Admin mutations are Server Actions, not route handlers

**Date:** 2026-07-30 | **Phase:** 4 | **Status:** Active
**Decision:** Every admin mutation is a Next.js Server Action in `app/(app)/admin/actions.ts`. There is no admin REST endpoint.
**Why:** The phase file requires CSRF protection on admin mutations. Server Actions verify the `Origin` header against the host before the action body runs, so CSRF is handled by the framework rather than by a token scheme we would have to implement, rotate, and get right. A route handler would need that scheme built from scratch.
**Enforcement:** `verify:admin` greps the actions file and asserts every exported function calls `requireAdmin()` and every mutating one calls `auditLog()`. A route-level test alone would miss an action that forgot the gate.
**Tradeoff:** No admin API for external scripts. If one is ever needed it must carry its own CSRF and auth, and cannot simply reuse these functions.

### DEC-012 — Suspension is enforced in RLS, not only in the route

**Date:** 2026-07-30 | **Phase:** 4 | **Status:** Active
**Decision:** `profiles.suspended` gates writes through row-level security (`is_suspended()` in migration `20260730120005`), in addition to the 403 returned by `/api/chat`.
**Why:** A check that lives only in one route handler is one forgotten call site away from being useless — and Phase 6 adds uploads, Phase 7 adds more endpoints. Putting it in the database means every current and future write path inherits it.
**Detail:** suspension blocks writes but not reads. A suspended user keeps their history and can sign in; they just cannot add to it. Deleting their data would be a different, much more destructive decision.
**Note:** `suspended` is not in the master spec's schema, which lists only `role` on `profiles` — but the spec's own feature list asks for suspend/activate, so the column is required to build what was specified.

### DEC-011 — `validateKey()` must spend a token, never just list models

**Date:** 2026-07-30 | **Phase:** 3 | **Status:** Active
**Decision:** Every adapter's `validateKey()` performs a real (tiny) generation. Listing models is explicitly not acceptable as a validation check.
**Why:** An unfunded key authenticates perfectly and lists models happily — it fails only when asked to do work. The first OpenAI key supplied for this project did exactly that: HTTP 200 on `/v1/models`, `insufficient_quota` on every completion. A models-list check would have reported it healthy and Phase 4's "Test Connection" button would have lied to the admin.
**Tradeoff:** Validation costs a fraction of a cent and a round trip. Worth it — the alternative is a green tick on a key that cannot work.
**Gotcha:** the probe needs a real token budget. OpenAI raises `invalid_request_error` when `max_completion_tokens` can't fit a whole message, so a 1-token probe fails on a healthy key; Anthropic truncates instead. The OpenAI probe uses 16.

### DEC-010 — Provider marks are lettermark badges, not vendor logos

**Date:** 2026-07-30 | **Phase:** 3 | **Status:** Active
**Decision:** The model selector shows a coloured lettermark per provider rather than the vendors' actual logos.
**Why:** The phase file asks for "provider logos", but reproducing a trademark from memory ships a wrong approximation of someone else's brand. A neutral badge is honest and swappable.
**Tradeoff:** Less polished than real logos. `components/chat/provider-logo.tsx` is the single swap point if official assets are obtained — and an unknown provider degrades to its initial automatically, so new providers need no artwork.

### DEC-009 — Chat streams as newline-delimited JSON, not SSE

**Date:** 2026-07-30 | **Phase:** 2 | **Status:** Active
**Decision:** `/api/chat` returns `application/x-ndjson` — one JSON event per line (`text`, `done`, `error`) — read with a plain `fetch` reader.
**Why:** The endpoint is a POST carrying conversation state, and `EventSource` only issues GETs, so SSE would have meant a side-channel to pass the body. NDJSON needs no client library and no framing rules beyond splitting on newlines.
**Tradeoff:** No automatic reconnect (SSE gives that free). Irrelevant here — a dropped chat stream should surface an error and let the user retry, not silently resume mid-sentence.

### DEC-008 — Extended thinking is off for chat

**Date:** 2026-07-30 | **Phase:** 2 | **Status:** Active
**Decision:** The Anthropic adapter sends `thinking: {type: 'disabled'}` with `claude-opus-5`. Thinking is **on by default** on that model, so this is an explicit opt-out, not the default.
**Why:** Interactive chat is judged on time-to-first-token. Thinking delays the first visible character and bills tokens the user never sees. Phase 5/7 can expose it as a per-model toggle once there's UI to display reasoning.
**Consequences to carry forward:**

- Disabling thinking is only valid at `effort` **high or below** — pairing it with `xhigh`/`max` is a 400. The default effort is `high`, so the current call is valid; raising effort later means re-enabling thinking.
- With thinking off, Opus 5 can leak internal XML into the visible response. The documented mitigation is a **generic** "do not include internal or system XML tags" instruction — and explicitly **not** an instruction telling the model not to reason, which makes leakage worse. That wording is in `lib/providers/anthropic.ts`; don't "improve" it into a don't-think rule.

**Source:** https://platform.claude.com/docs/en/about-claude/models/migration-guide
**Tradeoff:** Lower answer quality on hard reasoning prompts than thinking-on would give.

### DEC-007 — Provider order follows the phase file; OpenAI waits for Phase 3

**Date:** 2026-07-30 | **Phase:** 2 | **Status:** Active
**Decision:** Phase 2 is built against **Anthropic**, as its phase file specifies, even though an OpenAI key was available first. OpenAI becomes the second provider in Phase 3, with `gpt-5.4-mini` as its default model.
**Why:** The master spec only says "one provider" for Phase 2, so the order was genuinely arbitrary and swapping would have cost nothing structurally. Keeping the phase file authoritative was chosen over convenience — Phase 3 needs both providers regardless, so nothing is lost, and the phase files stay trustworthy as written.
**Tradeoff:** Phase 2 is blocked until an Anthropic key exists ([ISSUE-010](ISSUES.md)), despite a working OpenAI key sitting in `.env.local`.

### DEC-006 — Route protection is layered, not delegated to middleware

**Date:** 2026-07-30 | **Phase:** 1 | **Status:** Active
**Decision:** `proxy.ts` redirects unauthenticated requests, but every protected page also calls `requireUser()` / `requireAdmin()` server-side. Both use `getUser()`, never `getSession()`.
**Why:** Middleware is a convenience gate — it can be bypassed in some deployment topologies, and it runs before the page decides anything. `getSession()` only decodes the cookie without verifying it against the Auth server, so it is not safe for authorization. RLS is the final backstop underneath both.
**Tradeoff:** One extra auth round-trip per protected render. Worth it; `verify:gates` covers the non-admin `/admin` path explicitly.

### DEC-005 — Provider secrets protected by column-level grants, not RLS

**Date:** 2026-07-30 | **Phase:** 1 | **Status:** Active
**Decision:** `SELECT` on `public.providers` is revoked from `authenticated`, then re-granted on `(id, name, enabled, created_at, updated_at)` only. A `providers_public` view (`security_invoker = true`) gives clients a `select *` they can actually use.
**Why:** The spec asks for providers to be "readable (non-secret columns) by authenticated users." RLS is **row**-level and cannot hide a **column**, so no policy can protect `encrypted_api_key` — a column grant is the only mechanism that does. This is a deviation in mechanism, not intent.
**Tradeoff:** `select *` on the base table now errors for normal users, which is surprising until you know why. The view exists to absorb that. `verify:rls` asserts both the block and the view.

### DEC-004 — Migrations run against the hosted database; no local Supabase stack

**Date:** 2026-07-30 | **Phase:** 1 | **Status:** Active
**Decision:** The Supabase CLI is installed as an npm devDependency and linked to project `uorgodndubyznjzotzje`. Migrations apply with `supabase db push`. No Docker, no local stack.
**Why:** Docker Desktop is not installed and the local stack is the only thing that needs it. Remote-only gets Phase 1 moving today with no extra tooling.
**Tradeoff:** Every migration test hits the real cloud database, and `supabase db reset --linked` would destroy it rather than a throwaway local copy. Acceptable while the project is empty. Revisit — install Docker and move to a local stack — before the database holds data worth keeping. Tracked as [ISSUE-004](ISSUES.md).

### DEC-003 — Supabase's new API key format (`sb_publishable_` / `sb_secret_`)

**Date:** 2026-07-30 | **Phase:** 1 | **Status:** Active
**Decision:** This project uses Supabase's new API keys, **not** the legacy `anon` / `service_role` JWTs. All Supabase client code must be written for that format.
**Why:** The keys issued for this project are already new-format. Legacy JWT keys are deprecated and scheduled for removal by end of 2026, so building against them would mean a forced migration later.
**Rules that follow — these bind all future phases:**

- The keys are **opaque strings, not JWTs**. Never decode, parse, or inspect claims from a key. Anything that expects to read `role` out of the key will fail.
- They cannot be sent as `Authorization: Bearer`. They belong in the `apikey` header — `supabase-js` and `@supabase/ssr` handle this, so use the SDK rather than hand-rolled `fetch`.
- `sb_publishable_` is the browser-safe key (replaces `anon`); `sb_secret_` is server-only (replaces `service_role`) and **still bypasses RLS** via the `service_role` Postgres role.
- Supabase Edge Functions only verify legacy JWTs, so any Edge Function must be deployed with `--no-verify-jwt` and do its own auth check.
- Env var **names** stay legacy-styled (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) while holding new-format **values**. Intentional, so it doesn't read as a mistake.

**Source:** https://supabase.com/docs/guides/api/api-keys
**Tradeoff:** Some third-party tutorials and older libraries still assume JWT keys and will need adapting.

### DEC-002 — Wiki lives in the repo, not an external tracker

**Date:** 2026-07-30 | **Phase:** 0 | **Status:** Active
**Decision:** Project state is tracked in `docs/wiki/` as Markdown, versioned alongside the code.
**Why:** State stays in sync with the commit that changed it and is readable at the start of every session without network access or a separate tool. An external tracker (GitHub Issues, Notion) would drift from the code and be invisible to a fresh session.
**Tradeoff:** No issue assignment, notifications, or cross-linking to PRs. Acceptable for a single-maintainer build; revisit if the project takes on collaborators.

### DEC-001 — Docs restructured to match the paths CLAUDE.md declares

**Date:** 2026-07-30 | **Phase:** 0 | **Status:** Active
**Decision:** Moved `CLAUDE.md` to the repo root, the master spec to `docs/00-PROJECT-SPEC.md`, and the eight phase files to `docs/phases/`. The original `Phases Files/files/` directory was removed.
**Why:** CLAUDE.md already referenced `@docs/00-PROJECT-SPEC.md` and `docs/phases/`, so both references were broken as delivered. CLAUDE.md is also only auto-loaded into a session when it sits at the repo root.
**Tradeoff:** None — no code referenced the old paths.
