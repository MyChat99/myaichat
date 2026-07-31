# Security

The security model, and what to do when something goes wrong.

## Reporting a vulnerability

Email the maintainer rather than opening a public issue. Include what you did,
what happened, and what you expected. Expect an acknowledgement within a few
days.

---

## The model

### Secrets

| Secret | Where it lives | Reaches the browser? |
|---|---|---|
| Provider API keys | `providers.encrypted_api_key`, AES-256-GCM | **Never** |
| `ENCRYPTION_MASTER_KEY` | Environment only | Never |
| Supabase secret key | Environment only | Never |
| Supabase publishable key | Environment | Yes — by design, constrained by RLS |

Provider keys are encrypted with **AES-256-GCM**, a fresh random IV per
encryption, in the format `v1.<iv>.<tag>.<ciphertext>`. The version prefix
allows an algorithm change without a flag day. GCM is authenticated, so a
tampered value fails to decrypt rather than silently returning corrupted bytes.

Only `key_last4` is stored in the clear, for the masked display.

Decryption happens in exactly one place — `lib/providers/registry.ts` — and the
plaintext exists only inside the adapter instance it is handed to. Every module
that touches a key imports `server-only`, so an accidental client import is a
**build error, not a leak**.

### Authorisation

Four layers, deliberately overlapping:

1. **`proxy.ts`** redirects unauthenticated page requests. A convenience gate,
   not a boundary — API routes are exempt so they can return JSON 401s
   (ISSUE-011).
2. **Every protected page and route handler** re-checks server-side with
   `getUser()`, which verifies against the Auth server. `getSession()` only
   decodes the cookie and is never used for authorisation.
3. **Row-level security** on all 9 public tables. This is the real boundary.
   `npm run security:audit` verifies it from the pg catalog, not from the
   migration files.
4. **Column-level grants** protect `providers.encrypted_api_key`, because RLS is
   row-level and *cannot* hide a column.

Notable specifics:

- `profiles.role` is pinned by a trigger — a user cannot promote themselves.
- Suspension is enforced in RLS, so every current and future write path
  inherits it rather than each remembering the check.
- Admin mutations are Server Actions, so CSRF is Next's Origin check rather than
  a hand-rolled token scheme.
- Re-authentication is required for provider key changes.

### Input handling

- Zod validation on every route handler and server action.
- Markdown runs `rehypeSanitize` **before** `rehypeHighlight`, so only markup we
  generate survives. Script tags, inline handlers and `javascript:` URLs are
  stripped — asserted by `npm run verify:chat`.
- Uploads use a MIME **allow-list**, a size cap from `system_settings`, and
  user-namespaced object keys so ownership is a string comparison.

### Rate limiting

| Surface | Limit |
|---|---|
| Chat | Per-user messages/hour (`system_settings`) |
| Tokens | Per-user daily token budget with hard cutoff |
| Uploads | 60 presign requests/hour/user |
| Login | Throttled per email + IP |

### Headers

CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy and
Permissions-Policy are set in `next.config.ts`.

**Known trade-off:** `script-src` includes `'unsafe-inline'`. The pre-paint theme
resolver is an inline script, and a nonce cannot apply to it without
reintroducing the flash of unstyled theme. Removing it means moving theme
resolution to a cookie read in `proxy.ts`. Documented rather than quietly
accepted.

### Object storage

The R2 bucket is **private**. No code path emits a public URL; reads go through
`/api/uploads/download`, which checks ownership and 302s to a short-lived
presigned GET. A 404 (not 403) is returned for another user's key, because a 403
confirms the file exists.

---

## Incident checklist

### A provider API key leaked

1. Rotate it at the provider (Anthropic / OpenAI console). **Do this first** —
   revocation stops the bleeding; everything else is cleanup.
2. Enter the new key in `/admin/providers` → Rotate. It is encrypted on write.
3. Check `/admin/analytics` for unexpected spend during the exposure window.
4. Review `/admin/audit` for `provider.key_set` entries you did not make.

### `ENCRYPTION_MASTER_KEY` leaked

1. Generate a new one: `openssl rand -base64 32`.
2. **Before replacing it**, decrypt and re-encrypt every stored provider key —
   the old key is the only thing that can read them. Simplest safe path: rotate
   the provider keys at their source, set the new master key, then enter the new
   provider keys fresh.
3. Update the value in `.env.local` **and** Railway.

### A user account is compromised

1. `/admin/users` → Suspend. Enforced in RLS, so it takes effect immediately on
   every write path.
2. Reset their password from the Supabase dashboard.
3. Check `/admin/audit` if the account had admin rights.

### The database is exposed

1. Rotate the Supabase secret key (Project Settings → API Keys).
2. Update `.env.local` and Railway.
3. Re-run `npm run security:audit` to confirm RLS is intact on every table.
4. Assume anything readable by `service_role` was readable — that key bypasses
   RLS entirely.

### Suspected unauthorised admin action

`/admin/audit` records actor, action, target, IP and timestamp for every admin
mutation. Entries are written with the secret key and there is no client-facing
insert policy, so they cannot be forged from a browser.

---

## Running the audit

```bash
npm run security:audit
```

Checks committed secrets (by credential *shape*, not by variable name),
dependency advisories, and RLS coverage across every public table. It runs in CI
as a **non-blocking** job — the dependency tree carries known transitive
advisories that cannot clear without downgrading Next itself (ISSUE-006), and a
check that always fails is a check nobody reads.

## Known gaps

Tracked in [docs/wiki/ISSUES.md](docs/wiki/ISSUES.md):

- One Supabase project serves local, CI and production (ISSUE-015).
- `lib/db/types.ts` is hand-maintained and can drift from the schema (ISSUE-005).
- 12 high transitive advisories, all dev-time or build-time (ISSUE-006).
