# Phase 6 — Cloudflare R2 Uploads + Resend Emails

## Goal
File attachments in chat (stored on R2) and branded transactional email (via Resend) are live.

## Prerequisites
R2 bucket + API credentials; Resend API key + verified sending domain.

## Tasks
1. R2 client in /lib/r2 (S3-compatible SDK). Server route issues time-limited presigned upload URLs after validating auth, file type (images, PDF, txt/md), and size (max from system_settings).
2. Composer attachment UX: attach button + drag-and-drop, upload progress, thumbnail/chip previews, remove before send.
3. Store attachment metadata on messages (jsonb). Serve downloads via short-lived presigned GET URLs — bucket stays private.
4. Pass image attachments to vision-capable models and document attachments to document-capable models through the provider abstraction; if the selected model supports neither, show a clear notice.
5. Avatar upload on the profile page (R2, image validation, old avatar cleanup).
6. Resend integration with React Email templates in /emails: welcome/verification, password reset, magic link, admin alert (e.g., provider key test failure). Branded, dark-mode-friendly templates.
7. Wire Supabase auth emails to the Resend flow (or configure Supabase SMTP to Resend) so all mail is branded.

## Acceptance criteria
- Upload → send → model receives the attachment; unauthorized/oversized/wrong-type uploads rejected server-side
- Direct bucket URLs do not work; only presigned URLs do
- All four emails send and render well in light and dark email clients
- lint + type-check + build pass
