-- Phase 1 — core schema
-- Tables per docs/00-PROJECT-SPEC.md. RLS is enabled in a later migration.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums

create type public.user_role as enum ('user', 'admin');
create type public.message_role as enum ('user', 'assistant', 'system');

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  role         public.user_role not null default 'user',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'Public user profile, 1:1 with auth.users. Role drives admin access.';

-- ---------------------------------------------------------------- providers

create table public.providers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  encrypted_api_key text,
  key_last4         text,
  enabled           boolean not null default false,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.providers.encrypted_api_key is
  'AES-256-GCM ciphertext. NEVER exposed to clients — column-level grants in the RLS migration enforce this.';

-- ---------------------------------------------------------------- models

create table public.models (
  id                  uuid primary key default gen_random_uuid(),
  provider_id         uuid not null references public.providers (id) on delete cascade,
  model_id            text not null,
  display_name        text not null,
  max_tokens          integer not null default 4096 check (max_tokens > 0),
  default_temperature numeric(3, 2) not null default 1.0 check (default_temperature between 0 and 2),
  input_cost_per_1k   numeric(12, 6) not null default 0 check (input_cost_per_1k >= 0),
  output_cost_per_1k  numeric(12, 6) not null default 0 check (output_cost_per_1k >= 0),
  enabled             boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider_id, model_id)
);

-- ---------------------------------------------------------------- conversations

create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default 'New chat',
  model_id   uuid references public.models (id) on delete set null,
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- messages

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role            public.message_role not null,
  content         text not null default '',
  attachments     jsonb not null default '[]'::jsonb,
  input_tokens    integer not null default 0 check (input_tokens >= 0),
  output_tokens   integer not null default 0 check (output_tokens >= 0),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- user_preferences

create table public.user_preferences (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  theme             text not null default 'system' check (theme in ('light', 'dark', 'system')),
  accent_color      text not null default 'blue',
  font_size         text not null default 'md' check (font_size in ('sm', 'md', 'lg')),
  bubble_style      text not null default 'bubbles' check (bubble_style in ('bubbles', 'flat')),
  default_model_id  uuid references public.models (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------- usage_logs

create table public.usage_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users (id) on delete set null,
  model_id       uuid references public.models (id) on delete set null,
  input_tokens   integer not null default 0 check (input_tokens >= 0),
  output_tokens  integer not null default 0 check (output_tokens >= 0),
  estimated_cost numeric(12, 6) not null default 0 check (estimated_cost >= 0),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- audit_logs

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- system_settings

create table public.system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------------------------------------------------------------- indexes

create index conversations_user_id_updated_at_idx
  on public.conversations (user_id, updated_at desc);
create index conversations_user_id_pinned_idx
  on public.conversations (user_id, pinned) where pinned;
create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);
create index usage_logs_user_id_created_at_idx
  on public.usage_logs (user_id, created_at desc);
create index usage_logs_created_at_idx
  on public.usage_logs (created_at desc);
create index usage_logs_model_id_idx
  on public.usage_logs (model_id);
create index audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index audit_logs_actor_id_idx
  on public.audit_logs (actor_id);
create index models_provider_id_enabled_idx
  on public.models (provider_id, enabled);

-- ---------------------------------------------------------------- updated_at

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger providers_set_updated_at
  before update on public.providers
  for each row execute function public.set_updated_at();
create trigger models_set_updated_at
  before update on public.models
  for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();
