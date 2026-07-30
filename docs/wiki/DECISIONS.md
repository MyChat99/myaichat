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
