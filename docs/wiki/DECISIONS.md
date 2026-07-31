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
