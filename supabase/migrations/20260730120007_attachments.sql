-- Phase 6 — attachments and model capabilities
--
-- Additive only. `messages.attachments` (jsonb) has existed since Phase 1; this
-- adds the per-model capability facts the chat route needs to decide whether an
-- attachment can be sent at all.

alter table public.models
  add column if not exists supports_vision boolean not null default false,
  add column if not exists supports_documents boolean not null default false;

comment on column public.models.supports_vision is
  'Model accepts image inputs. Drives the "this model cannot read attachments" notice.';
comment on column public.models.supports_documents is
  'Model accepts PDF/document inputs.';

-- Avatars are stored on R2; profiles keeps only the object key so the bucket
-- can stay private and URLs stay short-lived.
comment on column public.profiles.avatar_url is
  'R2 object key (not a public URL). Served via short-lived presigned GETs.';

-- Every model seeded so far is vision-capable; documents differ by provider.
update public.models set supports_vision = true
  where model_id in ('claude-opus-5', 'claude-haiku-4-5', 'gpt-5.4', 'gpt-5.4-mini');

update public.models set supports_documents = true
  where model_id in ('claude-opus-5', 'claude-haiku-4-5');
