-- Phase 1 — Row Level Security
--
-- Every table gets RLS. Note that RLS is ROW-level and cannot hide a COLUMN,
-- so `providers.encrypted_api_key` is protected by column-level GRANTs instead
-- (see the providers section). See docs/wiki/DECISIONS.md (DEC-005).

alter table public.profiles         enable row level security;
alter table public.providers        enable row level security;
alter table public.models           enable row level security;
alter table public.conversations    enable row level security;
alter table public.messages         enable row level security;
alter table public.user_preferences enable row level security;
alter table public.usage_logs       enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.system_settings  enable row level security;

-- ---------------------------------------------------------------- profiles

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles: admin reads all"
  on public.profiles for select
  to authenticated
  using ((select public.is_admin()));

-- Role is deliberately absent from what a user may change; the WITH CHECK
-- below pins it to its current value so a user cannot promote themselves.
create policy "profiles: update own non-role fields"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select p.role from public.profiles p where p.id = (select auth.uid()))
  );

create policy "profiles: admin updates all"
  on public.profiles for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------- providers
-- Column-level grants are the real protection for encrypted_api_key.
-- Supabase grants ALL on public tables to anon/authenticated by default, so we
-- revoke first and then re-grant only the safe columns.

revoke all on public.providers from anon, authenticated;
grant select (id, name, enabled, created_at, updated_at) on public.providers to authenticated;

create policy "providers: authenticated read enabled"
  on public.providers for select
  to authenticated
  using (enabled or (select public.is_admin()));

create policy "providers: admin writes"
  on public.providers for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Convenience view over the safe columns. security_invoker = true so the
-- caller's RLS still applies — this view is ergonomics, not a privilege gate.
create view public.providers_public
  with (security_invoker = true)
  as select id, name, enabled, created_at, updated_at
  from public.providers;

grant select on public.providers_public to authenticated;

-- ---------------------------------------------------------------- models

create policy "models: authenticated read enabled"
  on public.models for select
  to authenticated
  using (enabled or (select public.is_admin()));

create policy "models: admin writes"
  on public.models for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------- conversations

create policy "conversations: own rows"
  on public.conversations for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- messages
-- Ownership is indirect: a message belongs to whoever owns its conversation.

create policy "messages: own via conversation"
  on public.messages for all
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------- user_preferences

create policy "user_preferences: own row"
  on public.user_preferences for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- usage_logs
-- Read-only for the owner; writes happen server-side via the secret key.

create policy "usage_logs: read own"
  on public.usage_logs for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "usage_logs: admin reads all"
  on public.usage_logs for select
  to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------- audit_logs
-- Admin-read, system-write. No client-facing insert policy at all: audit rows
-- are written with the secret key so they cannot be forged from the browser.

create policy "audit_logs: admin reads"
  on public.audit_logs for select
  to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------- system_settings

create policy "system_settings: authenticated reads"
  on public.system_settings for select
  to authenticated
  using (true);

create policy "system_settings: admin writes"
  on public.system_settings for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------- anon lockout
-- Unauthenticated callers get nothing from the app schema. Auth flows go
-- through Supabase Auth (auth schema), not these tables.

revoke all on public.profiles, public.models, public.conversations,
  public.messages, public.user_preferences, public.usage_logs,
  public.audit_logs, public.system_settings
  from anon;
