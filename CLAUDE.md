# AI Chat SaaS Platform — Project Constitution

This file is loaded automatically at the start of every Claude Code session. Follow it strictly.

## What we are building

A production-ready, multi-provider AI chat SaaS (ChatGPT/Claude-style) with:

- Streaming chat UI with conversation history, model selector, file attachments
- Admin panel: encrypted provider API keys (OpenAI, Anthropic, extensible), model management, user management, analytics, audit logs
- User-facing theming: light/dark/system, accent colors, preset themes, persisted per user

Full specification: @docs/00-PROJECT-SPEC.md

## Mandatory stack (never substitute)

- Next.js 14+ App Router, TypeScript strict, Tailwind CSS, shadcn/ui, Framer Motion
- Supabase: PostgreSQL + Auth + RLS (migrations via Supabase CLI, committed to repo)
- Railway: hosting + environment variables
- Resend: all transactional email (React Email templates in /emails)
- Cloudflare R2: all file/object storage (S3-compatible SDK, presigned URLs)
- GitHub + GitHub Actions: CI/CD

## Non-negotiable security rules

1. Provider API keys NEVER reach the client — no client bundles, network responses, or logs.
2. Provider keys stored AES-256-GCM encrypted; master key only in env vars. Never plaintext in DB.
3. Every table has RLS policies. Users access only their own rows; admin tables gated by role.
4. Zod validation on every API route input. Sanitize rendered Markdown (XSS).
5. Rate limiting on chat and auth endpoints. Audit-log every admin mutation.
6. Never commit secrets. Keep .env.example current whenever env vars change.

## Conventions

- Directory layout: /app (routes), /components, /lib/providers, /lib/db, /lib/security, /lib/r2, /emails
- Provider abstraction: all LLM access goes through the ChatProvider interface (streamChat, listModels, validateKey). New providers = one adapter file only.
- Conventional commits (feat:, fix:, chore:). One commit per meaningful unit of work.
- All theming through CSS custom properties — no hardcoded colors in components.
- Accessibility: WCAG 2.1 AA. Respect prefers-reduced-motion.

## Project wiki (mandatory)

`docs/wiki/` is the single source of truth for project state. It holds PROGRESS.md (phase status), ISSUES.md (bugs, blockers, debt), DECISIONS.md (technical decisions and why), ROADMAP.md (pending and future work).

- At the START of every session, read `docs/wiki/PROGRESS.md` and `docs/wiki/ISSUES.md` before doing any work.
- UPDATE the wiki immediately after: completing or partially completing a phase, discovering or fixing a bug, making a notable technical decision, or leaving anything unfinished at the end of a session. Do not batch these to the end.
- Never mark a phase "Verified" in PROGRESS.md until lint, type-check, build, AND every acceptance criterion in that phase file have all passed. "Done" means built; "Verified" means proven.
- If asked "where are we?" or to verify project scope/progress, answer from the wiki files first, then confirm against the actual code and report any drift.
- Keep entries concise — status and facts, not essays. Newest entries at the top of ISSUES.md and DECISIONS.md.

## Workflow rules

- Work is divided into 8 phases in docs/phases/. Complete ONLY the phase you are asked to do.
- Before coding a phase: read its phase file fully, propose a short plan, then implement.
- After each phase: run lint + type-check + build, fix all errors, then summarize what was built and list any deviations from the phase file.
- Do not refactor previous phases unless the current phase file requires it.
- If a requirement is ambiguous, state your assumption and proceed.
