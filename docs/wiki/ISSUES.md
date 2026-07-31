# Issues

Known bugs, blockers, and technical debt. **Newest entries at the top.**

**Status:** `Open` · `Resolved`
**Severity:** `Critical` (blocks work / security hole) · `High` · `Medium` · `Low`

## Entry format

```
### ISSUE-NNN — Short title
**Status:** Open | **Severity:** High | **Phase:** 3 | **Opened:** YYYY-MM-DD | **Resolved:** —
**Problem:** What breaks, and how to reproduce.
**Resolution:** What fixed it, or current thinking if still open.
```

---

## Open

### ISSUE-015 — Verification suites share database state and interfere when chained

**Status:** Open | **Severity:** Medium | **Phase:** 8 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** `verify:admin` mutates rows every other suite reads — it disables a provider and breaks a stored key, restoring both in `finally`. Run back-to-back with `verify:providers`, assertions in one can observe the other's mid-flight state. Chaining them against production produced four failures that all passed when each suite ran alone.
**Partly fixed:** the target provider is now chosen from an **ordered** query. It was unordered, so each run disabled a different provider and the same bug looked like a different one each time.
**Still open:** there is one Supabase project for local and production, so a suite that dies before its `finally` can leave a provider disabled for real users. Two fixes, either sufficient: a separate Supabase project for tests, or a `verify:all` runner that serialises the suites and asserts clean state between them. Phase 8's CI work is the natural place — CI must not be able to disable a provider in production.

### ISSUE-006 — 12 high-severity advisories in the stock Next.js dependency tree

**Status:** Open | **Severity:** Low | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** A clean `create-next-app` on Next 16.2.12 reports 12 high-severity advisories, all transitive: `minimatch`/`brace-expansion` DoS through the ESLint chain (dev-only), `postcss` source-map path traversal (build-time), and `sharp`/libvips CVEs (image optimization). None introduced by our code.
**Resolution:** Left as-is — `npm audit fix --force` would downgrade Next itself. Re-check at Phase 8 when CI is set up; most should clear via upstream patch releases. Revisit sooner if `sharp` ends up on a request path handling untrusted images.

### ISSUE-005 — `supabase gen types` needs Docker, so `lib/db/types.ts` is hand-maintained

**Status:** Open | **Severity:** Medium | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** Type generation runs its introspection in a container, so it fails with `LegacyContainerRuntimeNotFoundError` without Docker. `lib/db/types.ts` is therefore written by hand and can silently drift from the migrations.
**Resolution:** Update `lib/db/types.ts` in the same commit as any migration change — noted in the file header and README. `npm run verify:schema` catches missing relations but **not** column-level drift. Resolves itself if Docker is installed (see ISSUE-004).

### ISSUE-004 — No local Supabase stack; migrations run against the hosted database

**Status:** Open | **Severity:** Low | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** Docker is not installed, so there is no local Supabase stack. Migrations apply to the hosted project via `supabase db push`, and `supabase db reset --linked` would drop and recreate the **remote** database. Harmless while the project is empty; destructive once real data exists.
**Resolution:** Use `db push` for normal migration work; never `reset --linked` without confirming first. Install Docker and switch to a local stack before the project holds data worth keeping. See [DEC-004](DECISIONS.md).

### ISSUE-014 — Build required runtime environment variables, so the first deploy failed

**Status:** Resolved | **Severity:** High | **Phase:** 8 (pulled forward) | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** `lib/env.ts` parsed the public schema at **module load**. Any import chain touching it therefore threw during `next build`, and Railway's first build died with `Failed to collect page data for /api/health` — a message that names the newest file rather than the actual cause, which sends you looking in the wrong place.
**Why it was invisible locally:** `.env.local` is always present on a dev machine, so the module-level parse always succeeded. The failure only appears where the variables are legitimately absent — which is every first deploy.
**Resolution:** `publicEnv` and `getServerEnv` are now lazy functions that throw a message naming the missing variable. A build no longer requires runtime config; a missing variable surfaces at request time instead of inside the bundler.
**Verified by** running `env -i npx next build` — a completely empty environment, reproducing the Railway condition. It now succeeds.
**Note:** `process.env.NEXT_PUBLIC_*` references are still written as full literals inside the function, because Next substitutes those exact strings at build time. Destructuring or computing the names would silently break client-side inlining.

### ISSUE-013 — Hand-maintained types drifted the moment a column was added

**Status:** Resolved | **Severity:** Low | **Phase:** 4 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** Adding `profiles.suspended` in migration `20260730120005` broke type-check in five files: `lib/db/types.ts` is hand-written (Docker is needed for `supabase gen types`), so the new column did not exist as far as TypeScript was concerned.
**Found by:** `npm run type-check`, immediately.
**Resolution:** Added the column to the `Row` and `Insert` shapes. This is [ISSUE-005](#) materialising exactly as predicted — worth noting that it failed *loudly and instantly*, which is the good case. The dangerous version is a column whose type changes rather than appears, since that can type-check while being wrong. Installing Docker and restoring generated types remains the real fix.

### ISSUE-012 — First OpenAI key was valid but unfunded

**Status:** Resolved | **Severity:** High | **Phase:** 3 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** The OpenAI key supplied for Phase 3 authenticated fine — HTTP 200 on `/v1/models` — but every completion returned `insufficient_quota`, including the cheapest model. OpenAI is prepaid with no free tier, and the account had no credit.
**Found by:** testing generation rather than authentication before building on the key. A models-list check would have reported it healthy.
**Resolution:** Replaced with a funded key, verified by an actual streamed completion. The lesson is encoded in [DEC-011](DECISIONS.md): `validateKey()` on every adapter performs a real generation, so Phase 4's "Test Connection" button cannot show a green tick for a key that can't work.

### ISSUE-010 — Phase 2 blocked: no Anthropic API key

**Status:** Open | **Severity:** High | **Phase:** 2 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** [PHASE-2-chat-streaming.md](../phases/PHASE-2-chat-streaming.md) specifies Anthropic as the single provider for Phase 2. No Anthropic key exists. An OpenAI key is available but was deliberately deferred to Phase 3 rather than swapping the provider order — see [DEC-007](DECISIONS.md).
**Resolution:** Get a key from console.anthropic.com, add `ANTHROPIC_API_KEY` to `.env.local`, then Phase 2 can start. Nothing else blocks it — Phase 1 is Verified.

### ISSUE-003 — R2, Resend, and Railway credentials not yet provisioned

**Status:** Open | **Severity:** Medium | **Phase:** 6, 8 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** No accounts or keys yet for Cloudflare R2 and Resend (Phase 6) or Railway (Phase 8). Each blocks its phase at the point of integration. Split out of ISSUE-002, which covered Supabase as well.
**Resolution:** Provision per phase as needed. Track every new variable in `.env.example`; real values go in Railway, never in the repo.

### ISSUE-001 — Commit author email may not match GitHub account

**Status:** Open | **Severity:** Low | **Phase:** 0 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** Git commits are authored as `myaichatbot@proton.me`, but the GitHub account is `MyChat99`. If that address is not verified on the account, commits will not link to the profile and contributions will not be attributed.
**Resolution:** Add and verify the address at github.com/settings/emails, or change `git config --global user.email` to the account's verified address. Cosmetic only — does not affect pushes.

---

## Resolved

### ISSUE-011 — Proxy redirected unauthenticated API calls to the login page

**Status:** Resolved | **Severity:** Medium | **Phase:** 2 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** `proxy.ts` matched `/api/*` and redirected unauthenticated requests to `/login` with a 307. A default `fetch` follows redirects, so an unauthenticated `POST /api/chat` came back as **200 with an HTML login page** — and the route handler's own 401 was unreachable. Any client treating 200 as success would have parsed HTML as a chat stream.
**Found by:** `npm run verify:chat`. The first version of that check used a default `fetch` and reported the followed redirect's 200 as the endpoint's status, so the assertion caught the symptom but the diagnosis needed `redirect: 'manual'`.
**Resolution:** `updateSession` now returns early for `/api/*` — the session cookie is still refreshed, but no redirect is issued, so route handlers return a real JSON 401. The check now asserts both the 401 **and** a JSON content-type with `redirect: 'manual'`, so a regression can't hide behind a followed redirect again.

### ISSUE-009 — Self-referential `--font-sans` made every page render in serif

**Status:** Resolved | **Severity:** Low | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** `shadcn init` wrote `--font-sans: var(--font-sans)` into the `@theme inline` block in `app/globals.css`. A variable defined as itself resolves to nothing, so `font-sans` fell through to the browser default and the whole app rendered in Times-style serif — not the Geist the layout loads, and not the "refined typography" the spec calls for.
**Found by:** looking at the running app during the Phase 1 browser walkthrough. Lint, type-check, build and all 41 automated checks passed with this bug present — nothing in the current suite can see rendered output.
**Resolution:** Point the theme variables at the names `app/layout.tsx` actually defines (`--font-geist-sans` / `--font-geist-mono`). Worth remembering that visual regressions are invisible to this test suite; Phase 7's Lighthouse pass is the first automated check that would plausibly catch a class of them.

### ISSUE-008 — Seed script crashed on a null-valued system setting

**Status:** Resolved | **Severity:** Medium | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** `npm run seed` failed with `null value in column "value" of relation "system_settings" violates not-null constraint`. The script seeded `{ key: 'default_model_id', value: null }`, but `system_settings.value` is `jsonb NOT NULL` and PostgREST sends a JS `null` as SQL NULL, not JSON `null`. The run aborted after creating the admin user but before the settings insert, leaving the database half-seeded.
**Resolution:** `default_model_id` is no longer seeded — no models exist until Phase 3, and a row pointing at nothing is worse than an absent row since readers must handle the missing case either way. Phase 3 inserts it once there is a real model to name. The settings type is now `NonNullable<…>`, so a null value is a type error rather than a runtime failure.
**Also hardened:** the seed is now provably re-runnable. The email is trimmed and lowercased before lookup (Supabase stores lowercase, and `.env.local` had a leading space), and a 422 "already registered" from `createUser` adopts the existing account instead of throwing. Confirmed by running the seed three times, then `npm run verify:seed` — exactly one auth user, one admin profile, four settings, no nulls. That check is committed so the regression cannot come back silently.

### ISSUE-007 — Infinite recursion in the profiles UPDATE policy blocked all profile edits

**Status:** Resolved | **Severity:** High | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** The first `profiles` UPDATE policy pinned `role` with a `WITH CHECK` subquery reading `public.profiles`. A policy **on** a table that SELECTs **from** that table re-enters its own policy set, so Postgres aborted every normal-user profile update with `42P17 infinite recursion detected in policy for relation "profiles"` — display-name changes included. It blocked privilege escalation only by failing outright, which looked like a pass in the first version of `verify:rls`.
**Found by:** `npm run verify:rls`, then confirmed by reading the role back with the secret key rather than trusting the response.
**Resolution:** Migration `20260730120004_fix_profile_role_guard.sql`. The policy is now a plain ownership check; `role` is pinned by a `BEFORE UPDATE` trigger that reverts changes unless the caller is `service_role` or already an admin. `verify:rls` now asserts against the stored value and also checks that a legitimate display-name update still succeeds. Note `public.is_admin()` never recursed — it is `SECURITY DEFINER` and owned by the table owner; the bare subquery was the bug. See [DEC-005](DECISIONS.md).

### ISSUE-002 — Supabase credentials not yet provisioned

**Status:** Resolved | **Severity:** Medium | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** No Supabase project or keys existed, blocking all of Phase 1 (auth, schema, RLS).
**Resolution:** Project `uorgodndubyznjzotzje` provisioned. URL, publishable key, secret key, and DB password stored in `.env.local` at the repo root — gitignored via `.env.*` and verified untracked. Keys use Supabase's new format, see [DEC-003](DECISIONS.md). Originally also covered R2/Resend/Railway; those were split out to ISSUE-003.
