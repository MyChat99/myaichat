# MASTER SPEC — Multi-Provider AI Chat SaaS Platform

> Reference document. Do not implement everything at once — follow docs/phases/ in order.

---

## ROLE & EXPERTISE

Act as a senior multidisciplinary engineering team combining the following roles, and apply the standards of each discipline throughout the build:

- **Full Stack Engineer** — Modern React/Next.js architecture, API design, performance optimization
- **AI Engineer / LLM Practitioner** — Multi-provider LLM integration (OpenAI, Anthropic, and extensible to others), streaming responses, token management, prompt handling, context-window management
- **Machine Learning Engineer** — Model configuration, temperature/top-p/max-token controls, usage analytics, cost tracking per model
- **Cyber Security Engineer** — OWASP Top 10 compliance, encrypted secrets management, secure authentication, rate limiting, input sanitization, audit logging
- **Database Engineer** — Normalized PostgreSQL schema design, Row Level Security (RLS), indexing strategy, migrations, connection pooling

---

## PROJECT OVERVIEW

Build a **production-ready, world-class SaaS web application**: a ChatGPT/Claude-style AI chat platform with a stunning, award-winning UI, a secure admin panel for managing AI provider API keys and models, and full user-facing theme customization.

---

## MANDATORY TECH STACK

| Layer                       | Technology                                                             | Purpose                                                                                     |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Version Control / CI-CD** | GitHub + GitHub Actions                                                | Repo, branch protection, automated lint/test/deploy pipeline                                |
| **Hosting / Deployment**    | Railway                                                                | App hosting, environment variables, auto-deploy from GitHub main branch                     |
| **Database + Auth**         | Supabase                                                               | PostgreSQL, Supabase Auth (email + OAuth), Row Level Security, Realtime                     |
| **Transactional Email**     | Resend                                                                 | Welcome emails, password resets, magic links, admin alerts                                  |
| **File / Object Storage**   | Cloudflare R2                                                          | User file uploads, avatars, chat attachments, exports (S3-compatible API, zero egress fees) |
| **Frontend**                | Next.js 14+ (App Router), TypeScript, Tailwind CSS                     | Type-safe, server components, streaming UI                                                  |
| **UI Components**           | shadcn/ui + Framer Motion + Lucide icons                               | Polished components and fluid animations                                                    |
| **AI SDKs**                 | Official OpenAI SDK + Anthropic SDK (via a provider-abstraction layer) | Streaming chat completions                                                                  |

Reference official docs for current model IDs and API usage rather than hardcoding assumptions: https://docs.claude.com/en/api/overview and https://platform.openai.com/docs

---

## CORE FEATURES

### 1. Chat Interface (User-Facing)

- Real-time **streaming responses** (Server-Sent Events / streaming fetch) with a typing indicator and token-by-token rendering
- Full **Markdown rendering** with syntax-highlighted code blocks and a one-click "Copy code" button
- **Conversation management**: sidebar with chat history, auto-generated conversation titles, rename, delete, pin, and search conversations
- **Model selector** in the chat header — users pick from admin-enabled models only (e.g., GPT models, Claude models)
- **Message actions**: copy, regenerate response, edit-and-resubmit user message
- **File attachments** (images, PDFs, text files) uploaded to Cloudflare R2 via presigned URLs, passed to vision/document-capable models
- **Stop generation** button mid-stream
- Graceful error states (rate limit hit, provider down, invalid key) with retry
- Fully **responsive**: mobile-first with a collapsible sidebar, desktop with keyboard shortcuts (Cmd/Ctrl+K new chat, etc.)
- Empty state with suggested starter prompts

### 2. Theme & Appearance Customization (User-Facing)

- **Light / Dark / System** mode toggle with smooth animated transition
- **Accent color picker**: at least 8 preset accent colors plus a custom HSL/hex picker
- **Preset themes** (minimum 6): e.g., Midnight, Ocean, Forest, Sunset, Rose, Mono — each defining background, surface, accent, and text tokens via CSS variables
- Adjustable **font size** and **chat bubble style** (bubbles vs. flat/document style)
- Preferences persisted per user in Supabase (`user_preferences` table) and applied instantly with no page reload
- Implement theming with **CSS custom properties + Tailwind**, so themes are data-driven, not hardcoded

### 3. Admin Panel (`/admin`, role-gated)

- **Provider containers/cards** — one card per AI provider (OpenAI, Anthropic, extensible to Google, Mistral, etc.), each showing:
  - Masked API key display (`sk-****...xxxx`) with edit, rotate, and delete actions
  - **"Test Connection"** button that validates the key against the provider's API and shows live status (✅ valid / ❌ invalid / latency)
  - Enabled/disabled toggle per provider
- **Model management** per provider: add/remove model entries (model ID, display name, max tokens, temperature default, enabled flag, per-1K-token cost for analytics). Where the provider offers a models-list endpoint, fetch available models dynamically instead of hardcoding.
- **User management**: list users, roles (user/admin), suspend/activate, per-user usage stats
- **Usage analytics dashboard**: charts (Recharts) for messages/day, tokens by model, estimated cost by provider, active users
- **System settings**: default model, global system prompt, per-user rate limits (messages/hour), max upload size
- **Audit log** view: every admin action (key changed, model added, user suspended) recorded with actor, timestamp, and IP

### 4. Authentication & Accounts

- Supabase Auth: email/password + Google OAuth (extensible)
- Email verification, password reset, and magic-link emails sent via **Resend** with branded HTML templates
- Roles: `user` and `admin`, enforced both in middleware and via Supabase RLS
- Profile page: display name, avatar (stored in R2), email

---

## SECURITY REQUIREMENTS (NON-NEGOTIABLE)

1. **API keys are never exposed to the client.** All LLM calls proxy through server-side API routes. Keys never appear in client bundles, network responses, or logs.
2. **Encrypt provider API keys at rest** using AES-256-GCM with an encryption key held only in Railway environment variables — never store plaintext keys in the database.
3. **Supabase Row Level Security on every table** — users can only read/write their own conversations, messages, and preferences; admin tables restricted to the admin role.
4. **Rate limiting** on chat and auth endpoints (per-user and per-IP) to prevent abuse and key drain.
5. **Input validation & sanitization** with Zod on every API route; sanitize rendered Markdown to prevent XSS.
6. **Security headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options.
7. **Presigned, time-limited R2 URLs** for uploads/downloads; validate file type and size server-side.
8. **CSRF protection** on state-changing admin routes; audit-log all admin mutations.
9. Never commit secrets — provide `.env.example`, and configure real values in Railway.

---

## DATABASE SCHEMA (Supabase / PostgreSQL)

Design and generate SQL migrations for at minimum:

- `profiles` (id → auth.users, display_name, avatar_url, role)
- `providers` (id, name, encrypted_api_key, key_last4, enabled, created_by)
- `models` (id, provider_id FK, model_id, display_name, max_tokens, default_temperature, input_cost_per_1k, output_cost_per_1k, enabled)
- `conversations` (id, user_id FK, title, model_id FK, pinned, created_at, updated_at)
- `messages` (id, conversation_id FK, role [user/assistant/system], content, attachments jsonb, input_tokens, output_tokens, created_at)
- `user_preferences` (user_id FK, theme, accent_color, font_size, bubble_style, default_model_id)
- `usage_logs` (id, user_id, model_id, input_tokens, output_tokens, estimated_cost, created_at)
- `audit_logs` (id, actor_id, action, target_type, target_id, metadata jsonb, ip, created_at)
- `system_settings` (key, value jsonb)

Include appropriate indexes (conversation lookups by user, messages by conversation, usage aggregation by date) and RLS policies for each table.

---

## UI / UX QUALITY BAR ("AWARD-WINNING")

- Design language: clean, spacious, glassmorphism-accented surfaces, subtle gradients, refined typography (e.g., Inter or Geist)
- **Framer Motion animations**: sidebar slide, message entrance (fade + slight rise), theme cross-fade, micro-interactions on buttons, skeleton loaders while streaming initializes
- Smooth auto-scroll during streaming with a "scroll to bottom" pill when the user scrolls up
- Delightful details: animated gradient on the send button, provider logos on the model selector, toast notifications (sonner), command palette (Cmd+K)
- Accessibility: WCAG 2.1 AA — keyboard navigable, focus rings, ARIA labels, prefers-reduced-motion respected, sufficient contrast in every theme
- Lighthouse targets: Performance ≥ 90, Accessibility ≥ 95

---

## ARCHITECTURE REQUIREMENTS

- **Provider abstraction layer**: a single `ChatProvider` interface (`streamChat()`, `listModels()`, `validateKey()`) with OpenAI and Anthropic implementations, so new providers are added by writing one adapter — no changes to UI or routes.
- Server-side streaming via Next.js Route Handlers (Edge or Node runtime as appropriate).
- Clear separation: `/app` (routes), `/components`, `/lib/providers`, `/lib/db`, `/lib/security`, `/lib/r2`, `/emails` (Resend React Email templates).
- Environment variables documented in `.env.example`: Supabase URL/keys, R2 account ID/access keys/bucket, Resend key, encryption master key, app URL.

---

## DEPLOYMENT & DEVOPS

1. GitHub repo with `main` (protected) and feature branches; conventional commits
2. GitHub Actions: lint (ESLint), type-check, test, then deploy to Railway on merge to `main`
3. Railway service connected to the GitHub repo with all environment variables configured
4. Supabase migrations managed via the Supabase CLI, committed to the repo
5. Cloudflare R2 bucket with CORS configured for the app domain
6. Health-check endpoint (`/api/health`) for Railway monitoring
7. A thorough `README.md`: local setup, environment variables, migration commands, deployment steps, and how to add a new AI provider

---

## DELIVERABLES

1. Complete, runnable codebase (TypeScript throughout, no placeholders or TODOs in core paths)
2. SQL migration files with RLS policies
3. `.env.example` and README with full setup instructions
4. Seed script that creates an admin user and default settings
5. Brief architecture overview (diagram or written) explaining the provider abstraction and security model

## BUILD ORDER

Phase 1: Project scaffold, Supabase auth + schema + RLS → Phase 2: Chat interface with streaming (one provider) → Phase 3: Provider abstraction + second provider + model selector → Phase 4: Admin panel (keys, models, users) → Phase 5: Theming system → Phase 6: R2 uploads + Resend emails → Phase 7: Analytics, audit logs, polish, animations → Phase 8: CI/CD + Railway deployment.

Ask clarifying questions before starting only if a requirement above is genuinely ambiguous; otherwise proceed and state your assumptions.
