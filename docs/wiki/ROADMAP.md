# Roadmap

Pending action items and what comes after the eight planned phases.

## Immediate next steps

Current state and the resume point live at the top of [PROGRESS.md](PROGRESS.md).
In priority order:

1. **Add R2 and Resend credentials** ([ISSUE-016](ISSUES.md), [ISSUE-017](ISSUES.md), [ISSUE-003](ISSUES.md)) — the only thing blocking a phase. Everything up to the integration point is built and tested; [PHASE-6-CHECKLIST.md](PHASE-6-CHECKLIST.md) is the exact sequence and needs no code change.
2. **Visual sign-offs** — the attachment UI, the analytics charts with demo data, and the export links. All built, none seen by a human.
3. **Screenshots** for the README (`npm run seed -- --demo` first) and then the LinkedIn post.
4. **Decide on deploy gating** ([ISSUE-027](ISSUES.md)) — prepared, not applied, with a recommendation to leave it alone for now.
5. **Phase 7 leftovers** — the performance pass and accessibility audit still need a browser and Lighthouse, so they stay unmeasurable headlessly.

Phases 1–5 complete, 6 blocked on credentials, 7 partial, 8 done. `main` is
protected: every change goes through a pull request with CI green.

**Operational note:** `ENCRYPTION_MASTER_KEY` is load-bearing. Every provider key
in the database is encrypted with it — lose it and they must all be re-entered.
The same value is set in Railway, and rotating it means re-encrypting every
stored key.

Worth doing, not blocking: install Docker for a local Supabase stack, which also
restores `supabase gen types` and retires the hand-maintained types file
([ISSUE-004](ISSUES.md), [ISSUE-005](ISSUES.md)).

## Planned phases

Build order is fixed by the [master spec](../00-PROJECT-SPEC.md). Current status lives in [PROGRESS.md](PROGRESS.md).

| #   | Phase                | Delivers                                                                           |
| --- | -------------------- | ---------------------------------------------------------------------------------- |
| 1   | Foundation           | Next.js scaffold, Supabase auth, schema, RLS, admin route gating                   |
| 2   | Chat streaming       | Streamed conversation UI, Markdown + syntax highlighting, history, stop/regenerate |
| 3   | Provider abstraction | `ChatProvider` interface, second provider, model selector, usage logging           |
| 4   | Admin panel          | Encrypted key storage, Test Connection, model + user management, audit logs        |
| 5   | Theming              | Light/dark/system, accent picker, preset themes, per-user persistence              |
| 6   | Storage & email      | R2 presigned uploads, attachments to vision models, Resend templates               |
| 7   | Analytics & polish   | Usage dashboards, audit log UI, Framer Motion, Lighthouse targets                  |
| 8   | CI/CD & deploy       | GitHub Actions, branch protection, Railway deploy, health check, README            |

## Credentials needed along the way

| Service             | Needed by | Purpose                           |
| ------------------- | --------- | --------------------------------- |
| Supabase            | Phase 1   | Postgres, auth, RLS               |
| OpenAI or Anthropic | Phase 2   | First provider's streaming chat   |
| Second LLM provider | Phase 3   | Proving the abstraction layer     |
| Cloudflare R2       | Phase 6   | File and avatar storage           |
| Resend              | Phase 6   | Transactional email               |
| Railway             | Phase 8   | Hosting and environment variables |

## Beyond Phase 8 — future enhancements

Not committed. Candidates once the core platform ships.

**Product**

- Additional providers (Google Gemini, Mistral, local/Ollama) — should be one adapter file each if Phase 3 is done right
- Conversation sharing via public read-only links
- Export a conversation to Markdown or PDF
- Prompt library / saved system prompts per user
- Folders or tags for organizing conversations
- Web search or retrieval (RAG) over user-uploaded documents

**Platform**

- Teams/organizations: shared workspaces, seat management, per-org billing
- Stripe billing with usage-based plans and quota enforcement
- Per-user and per-org spend caps with alerting
- Public API with scoped tokens for programmatic access

**Engineering**

- End-to-end tests (Playwright) covering the streaming path and admin gating
- Load testing the chat endpoint; connection pooling review under concurrency
- Structured logging and error tracking (Sentry)
- Response caching for repeated identical prompts to cut provider spend
- Staging environment on Railway mirroring production

## Gap found 2026-08-01 — nothing in this repo loads a page in a browser

Three defects shipped past 1,085 assertions because every one of them checks
bytes, database rows or source text, and none of them renders:

- a hydration mismatch on `/settings` (ISSUE-032), which the Next dev overlay
  had been reporting as "1 Issue" to nobody
- the app shell scrolling the header and sidebar away (ISSUE-029)
- 52 demo conversations sharing 5 titles (ISSUE-030) — visible the moment you
  look at the sidebar, invisible to a row count

All three were found in about twenty minutes by driving headless Chrome over
CDP — which needs no dependency, because Node ships a WebSocket client and
Chrome is already installed.

**Worth building:** a `verify:render` that loads the main routes signed in,
fails on any console error or hydration warning, and asserts the document does
not scroll. That is the cheap 80% and it would have caught all three.

## Shortlist from the 2026-08-02 competitive review

Full reasoning, feature matrix and the rejected list are in
[COMPETITIVE-ANALYSIS.md](COMPETITIVE-ANALYSIS.md). Ranked by *(demo value ×
confidence it can be finished completely)* ÷ *risk*. Every item has already been
through the project's value gate; the rejected ones are recorded there so the
decision does not get re-litigated.

| # | Item | Why | Size |
|---|---|---|---|
| 1 | **Document attachments** — PDF, txt, md, csv, docx, xlsx | Worst-felt gap against every competitor. The paperclip exists and takes images only, so it currently lies about what it accepts. Native pass-through where the provider supports documents, server-side extraction where it does not — a decision the provider abstraction is the right place to own | L |
| 2 | **"What this answer would have cost elsewhere"** | Pure arithmetic over data already stored: per-message token counts × the per-1K prices already on every model row. No second API call, no tokens spent. **Structurally impossible for a single-vendor product**, and it extends the one feature we have that none of them do | S |
| 3 | **Folders for conversations** | Second-worst gap; a flat list stops being navigable around twenty conversations. Take the grouping half of ChatGPT/Claude Projects and leave the shared-instructions half until asked | M |
| 4 | **Visible budget meter** | The daily token budget is already enforced and completely invisible until it refuses you. "You have used 40% of today" turns a punitive limit into a useful one. Self-hosted only — no hosted product will show you a spend meter | S |
| 5 | **Share a conversation by link** | Expected everywhere. Only worth building as expiring, revocable, explicitly opt-in, and a redacted snapshot rather than a live view — a public link is a new unauthenticated surface on a self-hosted app. If it cannot be built that way, do not build it | M |
| 6 | Admin-set model routing by task | A policy a self-hosted deployment can set and a hosted product cannot offer without undermining its own pricing. Real value; a settings surface plus a routing layer, and easy to get subtly wrong | L |

**Rejected, with reasons, in COMPETITIVE-ANALYSIS.md §4:** image generation, code
execution sandbox, third-party connectors, cross-chat memory harvesting, agent
modes, canvas, usage tiers. Web search with citations is also rejected for now —
Perplexity is already one of our four registered providers and does cited search
natively, so "choose the Sonar model" is a real answer that costs nothing to
build.
