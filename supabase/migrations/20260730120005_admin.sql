-- Phase 4 — admin panel support
--
-- Two additions the Phase 1 schema did not anticipate:
--   1. `profiles.suspended` — the master spec calls for suspend/activate but
--      the table it specifies has no column for it.
--   2. an `is_suspended()` helper, so RLS can block a suspended user's writes
--      at the database rather than trusting every call site to remember.

alter table public.profiles
  add column if not exists suspended boolean not null default false;

comment on column public.profiles.suspended is
  'Suspended users keep their data and can sign in, but cannot create conversations or messages.';

-- Same SECURITY DEFINER shape as is_admin(): a policy on `profiles` that reads
-- `profiles` directly would recurse (see ISSUE-007).
create or replace function public.is_suspended(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.suspended from public.profiles p where p.id = uid),
    false
  );
$$;

revoke all on function public.is_suspended(uuid) from public, anon;
grant execute on function public.is_suspended(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- suspension
-- Suspension is enforced in the database, not only in the API route. A
-- suspended user may still READ their history; they just cannot add to it.

drop policy if exists "conversations: own rows" on public.conversations;

create policy "conversations: read own"
  on public.conversations for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "conversations: write own unless suspended"
  on public.conversations for all
  to authenticated
  using (user_id = (select auth.uid()) and not (select public.is_suspended()))
  with check (user_id = (select auth.uid()) and not (select public.is_suspended()));

drop policy if exists "messages: own via conversation" on public.messages;

create policy "messages: read own via conversation"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

create policy "messages: write own via conversation unless suspended"
  on public.messages for all
  to authenticated
  using (
    not (select public.is_suspended())
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    not (select public.is_suspended())
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------- audit index
-- Phase 7 renders this newest-first filtered by actor and action.
create index if not exists audit_logs_action_created_at_idx
  on public.audit_logs (action, created_at desc);
