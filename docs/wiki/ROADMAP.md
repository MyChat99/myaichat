# Roadmap

Pending action items and what comes after the eight planned phases.

## Immediate next steps

1. **Close out Phase 3** — one browser click: open the model selector, switch provider mid-conversation, confirm the next reply comes from the new model.
2. **Start Phase 4** — read [PHASE-4-admin-panel.md](../phases/PHASE-4-admin-panel.md) in full, propose a plan, then implement. It needs `ENCRYPTION_MASTER_KEY` in `.env.local` (`openssl rand -base64 32`) for AES-256-GCM provider key storage. `validateKey()` already exists on every adapter, so the "Test Connection" button is wiring, not new logic.

Phases 1 and 2 are Verified; Phase 3 is Done pending that click. Both providers stream live, and models are selectable per conversation.

Worth doing soon, not blocking: install Docker to get a local Supabase stack, which also restores `supabase gen types` and removes the hand-maintained types file ([ISSUE-004](ISSUES.md), [ISSUE-005](ISSUES.md)).

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
