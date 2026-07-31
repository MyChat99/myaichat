# myaichat

A production-grade, multi-provider AI chat platform. Bring your own OpenAI and
Anthropic keys, and get streaming chat, an admin panel to manage providers and
models, per-user theming, usage analytics and an audit trail.

Built with Next.js 16 (App Router), Supabase (Postgres + Auth + RLS), and
Tailwind. TypeScript throughout, strict mode, no `any` in the core paths.

[![CI](https://github.com/MyChat99/myaichat/actions/workflows/ci.yml/badge.svg)](https://github.com/MyChat99/myaichat/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What it does

**For the person using it**

- **Streaming chat** with token-by-token rendering, stop-generation, regenerate,
  and edit-and-resubmit
- **Switch models mid-conversation** — Anthropic and OpenAI, in the same thread
- **Markdown with syntax-highlighted code**, sanitised against XSS, one-click copy
- **Conversation management** — search, rename, pin, delete
- **Seven themes** in light and dark, plus accent colour, font size and bubble
  style, persisted per user and applied with **no flash on load**
- **Command palette** (`⌘K`) and a keyboard-shortcut reference (`?`)

**For whoever runs it**

- **Encrypted provider keys** — AES-256-GCM at rest, never in a client bundle,
  never in a log, with a "test connection" that performs a real generation
  rather than an auth check
- **Model management** per provider, including per-1K token costs
- **Usage analytics** — messages per day, tokens by model, estimated spend
- **Rate limiting** (messages/hour) and a **daily token budget** (spend ceiling)
- **Audit log** of every admin mutation, with actor and timestamp
- **User management** — roles, suspension, per-user usage

## Screenshots

> Placeholders. Capture these four, drop them in `docs/screenshots/`, then
> replace each cell below with `![Chat](docs/screenshots/chat.png)`.

**Seed the demo data first**, or the analytics charts are three flat lines:

```bash
npm run seed -- --demo     # 52 conversations, 82 usage rows, spread over 30 days
npm run dev
```

| File | Screen | Capture it in this state |
| --- | --- | --- |
| `chat.png` | `/` or `/c/<id>` | **Mid-stream.** Send "Explain closures with an example", capture while tokens are still arriving so the cursor is visible. Model selector in shot. Sidebar showing several named conversations, not "New chat" ×3. |
| `themes.png` | `/settings` | A **non-default** preset selected — Midnight or Ocean. The live preview panel visible. The default looks like every other chat app; the point of this screen is that it does not have to. |
| `admin-providers.png` | `/admin/providers` | **After pressing Test connection**, so the green result and latency are on screen. Both provider cards visible with masked keys (`••••••••` + last four). |
| `admin-analytics.png` | `/admin/analytics` | The **30-day** range, so all three charts have shape. With demo data seeded this shows real variation rather than a flat line. |

Practical notes:

- **1600×1000** at 2× — legible on GitHub, not enormous in the repo.
- Check the header before you shoot: your account email is in it. Fine if you
  do not mind it public, worth signing in as a demo account if you do.
- A key's last four **is** rendered by design and is safe to show; the key
  itself never reaches the browser.
- Do not capture the composer's paperclip as though it works — file storage is
  blocked on credentials ([ISSUE-016](docs/wiki/ISSUES.md)), and the button is
  correctly disabled.

<!--
  Once the files exist:
  ![Chat](docs/screenshots/chat.png)
  ![Themes](docs/screenshots/themes.png)
-->

Six alternative interface concepts, as self-contained HTML, live in
[docs/mockups/](docs/mockups/) — open any of them directly in a browser.

## Status

Phases 1–5 are complete and verified; 6 is blocked on storage credentials and
7–8 are partially done. The honest, current state — including what is *not*
finished and why — is in [docs/wiki/PROGRESS.md](docs/wiki/PROGRESS.md), with
known problems in [docs/wiki/ISSUES.md](docs/wiki/ISSUES.md) and the reasoning
behind non-obvious choices in [docs/wiki/DECISIONS.md](docs/wiki/DECISIONS.md).

There is no test framework here. Every check is a script that exercises the real
database, the real server or the real source — see [Verification](#verification).

---

## Requirements

- Node 18+ (developed on 24)
- A Supabase project
- Docker is **not** required — migrations run against the hosted database
  (see [DEC-004](docs/wiki/DECISIONS.md))

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
npm run dev
```

### Environment

Every variable is documented in [.env.example](.env.example). The four needed to boot:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → Data API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API Keys → publishable (`sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys → secret (`sb_secret_…`) — **server only** |
| `SUPABASE_DB_PASSWORD` | Project Settings → Database — used by the CLI for `db push` |
| `ENCRYPTION_MASTER_KEY` | Generate: `openssl rand -base64 32` — see the warning below |

> **`ENCRYPTION_MASTER_KEY` is unrecoverable.** Every provider API key in the database is
> encrypted with it. Lose it and they all have to be re-entered; rotating it means
> re-encrypting every stored key. The same value must be set in Railway at deploy time.

> This project uses Supabase's **new** API key format (`sb_publishable_` / `sb_secret_`), not
> legacy `anon` / `service_role` JWTs. They are opaque strings — never decode them as JWTs.
> The variable names are legacy-styled on purpose; see [DEC-003](docs/wiki/DECISIONS.md).

## Database

Migrations live in [supabase/migrations/](supabase/migrations/) and apply to the hosted project.

```bash
npm run db:push      # apply pending migrations
npm run seed         # create the first admin user + default settings
npm run keys:encrypt # move provider keys from .env.local into encrypted DB storage
```

`npm run seed` needs `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env.local`. It is
idempotent — safe to re-run.

`lib/db/types.ts` is hand-maintained because `supabase gen types` needs Docker. **If you change
a migration, update that file in the same commit.**

## Verification

No test framework. Sixteen scripts, ~370 assertions, each exercising something
real — the bugs this project actually hit were not the kind a mocked unit test
catches. The pattern throughout is **assert stored state, not response shape**:
several real defects here produced responses indistinguishable from success.

```bash
npm run lint && npm run type-check && npm run build
```

| Script | Proves | Needs |
|---|---|---|
| `verify:authz` | no action or route was shipped without an auth gate | — |
| `verify:headers` | the security-header and CSP configuration | — |
| `verify:theme` | WCAG AA contrast across every theme, both modes | — |
| `verify:email` | email templates render and meet contrast | — |
| `verify:schema` | every table, view and function exists | database |
| `verify:rls` | user A cannot read or write user B's rows | database |
| `verify:seed` | exactly one admin, settings intact | database |
| `verify:security` | throttling, password rules, rate limit, token budget | database |
| `verify:storage` | presign/download rejection paths | database |
| `verify:gates` | anonymous and non-admin redirects | server |
| `verify:appearance` | the chosen theme is in the server-rendered HTML | db + server |
| `verify:chat` | a real streamed completion, persistence, stop, XSS | db + keys |
| `verify:providers` | no vendor SDK or name escaped `lib/providers` | db + keys |
| `verify:admin` | breaking **only** the DB key breaks chat — no silent env fallback | database |
| `security:audit` | secret shapes, advisories, RLS read from the **pg catalog** | database |
| `smoke` | a *running deployment*: headers as served, gates, assets | server |

```bash
npm run security:audit -- --history   # adds a full git-history secret scan
npm run smoke -- --url https://your-app.example.com
```

Scripts marked "server" need `npm run dev` running; override the target with
`BASE_URL=http://localhost:3001`. They create throwaway users and delete them
afterwards.

⚠️ `verify:admin` and `verify:security` **mutate shared state** — they break a
provider key or change a system setting and restore it in `finally`. Do not run
them against a database that matters while someone else is using it
([ISSUE-015](docs/wiki/ISSUES.md)).

## How it is put together

Three Supabase clients, and the distinction matters:

| Module | Key | RLS |
|---|---|---|
| [lib/db/client.ts](lib/db/client.ts) | publishable | enforced |
| [lib/db/server.ts](lib/db/server.ts) | publishable, cookie-bound | enforced |
| [lib/db/admin.ts](lib/db/admin.ts) | **secret** | **bypassed** |

`admin.ts` is marked `server-only`, so importing it from a Client Component is a build error.

Security posture:

- RLS on every table; `usage_logs` and `audit_logs` are read-only to clients and written server-side
- `providers.encrypted_api_key` is protected by **column-level grants**, not RLS — RLS is
  row-level and cannot hide a column. Clients read [`providers_public`](supabase/migrations/) instead.
- `profiles.role` is pinned by a trigger, so a user cannot promote themselves
- Route protection is layered: `proxy.ts` redirects, and every protected page re-checks
  server-side. Middleware is a convenience gate, not the boundary.

## Adding a new AI provider

One adapter file in [lib/providers/](lib/providers/) implementing `ChatProvider`, one line
in the registry, and database rows. No route or UI changes. Full instructions and the
vendor differences the abstraction absorbs: [lib/providers/README.md](lib/providers/README.md).

`npm run verify:providers` enforces this with `git grep` — no vendor SDK import and no
provider name may appear outside `lib/providers`.

### The key path

```mermaid
flowchart TB
    Browser["Browser<br/>publishable key only"]

    subgraph Next["Next.js (Railway)"]
        Proxy["proxy.ts<br/>refreshes session · redirects pages<br/>API routes exempt"]
        Pages["Server Components<br/>requireUser / requireAdmin"]
        Chat["/api/chat<br/>Zod · rate limit · token budget"]
        Registry["lib/providers/registry<br/>resolves model → adapter"]
        Crypto["lib/security/crypto<br/>AES-256-GCM"]
    end

    subgraph Data["Supabase (Postgres)"]
        RLS["Row-level security<br/>every table"]
        Keys[("providers.encrypted_api_key<br/>ciphertext at rest")]
    end

    Anthropic["Anthropic API"]
    OpenAI["OpenAI API"]

    Browser --> Proxy --> Pages
    Browser -- "POST NDJSON stream" --> Chat
    Pages --> RLS
    Chat --> RLS
    Chat --> Registry
    Registry -- "reads ciphertext" --> Keys
    Registry -- "decrypts in memory" --> Crypto
    Registry --> Anthropic
    Registry --> OpenAI

    style Keys fill:#fde68a,stroke:#b45309,color:#1f2933
    style Crypto fill:#fde68a,stroke:#b45309,color:#1f2933
```

**The key path is the part worth understanding.** A provider key is stored only
as ciphertext. `registry.ts` reads it, decrypts it with the master key from the
environment, and hands the plaintext to an adapter instance — which lives for one
request. No key ever crosses into a client bundle, and every module on that path
imports `server-only`, so an accidental client import fails the build rather than
leaking.

## Deployment

Live at `myaichat-production.up.railway.app`, deploying from `main`.

**Environment variables** — set these in Railway (Variables → Raw Editor):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ENCRYPTION_MASTER_KEY
NEXT_PUBLIC_APP_URL
```

Provider API keys are **not** among them — those live encrypted in the database
after Phase 4.

> `ENCRYPTION_MASTER_KEY` must match the value used to encrypt the stored keys,
> character for character. A different value means production cannot decrypt them.

**Health check:** `/api/health` returns 200 only when the database is reachable
*and* the encryption key is present. It deliberately checks dependencies rather
than returning a bare "ok" — a process that is up but cannot reach its database
is not healthy, and a check that says otherwise makes a broken deploy look
successful.

**Migrations** are promoted with `npm run db:push`, which applies any pending
files in `supabase/migrations/` to the linked project. There is currently one
Supabase project for local and production (ISSUE-015).

**CI** runs lint, type-check, formatting, build and the credential-free test
suites on every PR. The Railway deploy job in `.github/workflows/ci.yml` is
disabled on purpose — Railway deploys from GitHub directly, and enabling both
would produce two racing deployments per merge. The comment in that file explains
how to switch.

## Project layout

```
app/(auth)/      login, signup, auth server actions
app/(app)/       protected shell, chat root, /admin
lib/db/          Supabase clients, session refresh, generated-ish types
lib/security/    auth gates, Zod schemas
lib/providers/   LLM adapters — the only place a vendor SDK is imported
lib/r2/          object storage (Phase 6, awaiting credentials)
lib/theme/       theme tokens, CSS generation, contrast maths
components/      chat, admin, theming, motion, command palette
emails/          Resend templates (Phase 6, awaiting credentials)
scripts/         seed + the sixteen verification scripts
supabase/        migrations, committed and applied in order
docs/wiki/       progress, issues, decisions, roadmap
docs/mockups/    six self-contained interface concepts
```

## Contributing

Issues and pull requests welcome — [CONTRIBUTING.md](CONTRIBUTING.md) has the
setup, the branch/PR flow and the house rules.

The one thing worth knowing up front: **`main` rejects direct pushes**,
including the maintainer's. Every change goes through a pull request with CI
green. A `GH006` on `git push origin main` is the rule working, not a fault.

## Security

Provider keys are encrypted at rest and never reach the client. Every table has
row-level security. If you find a vulnerability, please report it privately —
see [SECURITY.md](SECURITY.md), which also documents the known gaps rather than
pretending there are none.

## License

[MIT](LICENSE) © 2026 Muhammad Bin Zeeshan
