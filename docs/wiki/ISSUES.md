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

### ISSUE-002 — Supabase credentials not yet provisioned
**Status:** Resolved | **Severity:** Medium | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** No Supabase project or keys existed, blocking all of Phase 1 (auth, schema, RLS).
**Resolution:** Project `uorgodndubyznjzotzje` provisioned. URL, publishable key, secret key, and DB password stored in `.env.local` at the repo root — gitignored via `.env.*` and verified untracked. Keys use Supabase's new format, see [DEC-003](DECISIONS.md). Originally also covered R2/Resend/Railway; those were split out to ISSUE-003.
