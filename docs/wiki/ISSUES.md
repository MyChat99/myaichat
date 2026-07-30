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

### ISSUE-002 — External service credentials not yet provisioned
**Status:** Open | **Severity:** Medium | **Phase:** 1, 6, 8 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** No accounts or keys exist yet for Supabase (Phase 1), Cloudflare R2 and Resend (Phase 6), or Railway (Phase 8). Each will block its phase at the point of integration.
**Resolution:** Provision per phase as needed. Track every new variable in `.env.example`; real values go in Railway, never in the repo.

### ISSUE-001 — Commit author email may not match GitHub account
**Status:** Open | **Severity:** Low | **Phase:** 0 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** Git commits are authored as `myaichatbot@proton.me`, but the GitHub account is `MyChat99`. If that address is not verified on the account, commits will not link to the profile and contributions will not be attributed.
**Resolution:** Add and verify the address at github.com/settings/emails, or change `git config --global user.email` to the account's verified address. Cosmetic only — does not affect pushes.

---

## Resolved

_None yet._
