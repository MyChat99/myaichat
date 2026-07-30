# Phase 4 — Admin Panel: Keys, Models, Users

## Goal
Admins manage everything from /admin: encrypted provider keys, models, users, and system settings — with a full audit trail.

## Tasks
1. Admin layout with sidebar navigation: Providers, Models, Users, Settings, (Analytics + Audit Log added in Phase 7).
2. AES-256-GCM encryption utilities in /lib/security using a master key from env. Store `encrypted_api_key` + `key_last4` in the providers table. Decrypt only server-side at call time.
3. Providers page — one card/container per provider (OpenAI, Anthropic, + "Add provider"):
   - Masked key display (last 4 chars), edit/rotate/delete key
   - "Test Connection" button → calls the adapter's `validateKey()`, shows ✅/❌ + latency
   - Enable/disable toggle
4. Models page: CRUD for model entries per provider (model ID, display name, max tokens, default temperature, input/output cost per 1K, enabled). "Fetch from provider" button where `listModels()` is supported.
5. Migrate the chat pipeline to read provider keys from the encrypted DB storage instead of env vars (env fallback allowed for local dev only).
6. Users page: list with search, role display, promote/demote admin, suspend/activate. Suspended users cannot chat.
7. Settings page: default model, global system prompt, per-user rate limit, max upload size (writes to system_settings).
8. Audit logging middleware: every admin mutation writes actor, action, target, metadata, IP to audit_logs. CSRF protection on all admin mutations.

## Acceptance criteria
- Keys never appear in plaintext in DB, client, or logs; masked in UI
- Test Connection correctly distinguishes valid vs invalid keys
- Chat uses DB-stored encrypted keys; disabling a provider hides its models from the selector
- Non-admins blocked from every /admin route AND admin API endpoints (verify both)
- Every admin action appears in audit_logs
- lint + type-check + build pass
