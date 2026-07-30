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

### ISSUE-007 — Infinite recursion in the profiles UPDATE policy blocked all profile edits

**Status:** Resolved | **Severity:** High | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** The first `profiles` UPDATE policy pinned `role` with a `WITH CHECK` subquery reading `public.profiles`. A policy **on** a table that SELECTs **from** that table re-enters its own policy set, so Postgres aborted every normal-user profile update with `42P17 infinite recursion detected in policy for relation "profiles"` — display-name changes included. It blocked privilege escalation only by failing outright, which looked like a pass in the first version of `verify:rls`.
**Found by:** `npm run verify:rls`, then confirmed by reading the role back with the secret key rather than trusting the response.
**Resolution:** Migration `20260730120004_fix_profile_role_guard.sql`. The policy is now a plain ownership check; `role` is pinned by a `BEFORE UPDATE` trigger that reverts changes unless the caller is `service_role` or already an admin. `verify:rls` now asserts against the stored value and also checks that a legitimate display-name update still succeeds. Note `public.is_admin()` never recursed — it is `SECURITY DEFINER` and owned by the table owner; the bare subquery was the bug. See [DEC-005](DECISIONS.md).

### ISSUE-002 — Supabase credentials not yet provisioned

**Status:** Resolved | **Severity:** Medium | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** No Supabase project or keys existed, blocking all of Phase 1 (auth, schema, RLS).
**Resolution:** Project `uorgodndubyznjzotzje` provisioned. URL, publishable key, secret key, and DB password stored in `.env.local` at the repo root — gitignored via `.env.*` and verified untracked. Keys use Supabase's new format, see [DEC-003](DECISIONS.md). Originally also covered R2/Resend/Railway; those were split out to ISSUE-003.
