-- Per-endpoint request counters, for rate limiting anything that is not chat.
--
-- WHY a table rather than counting existing rows: the presign route previously
-- rate-limited itself by counting its own `audit_logs` entries. That coupled
-- two unrelated concerns — an audit trail is a permanent record and a rate
-- limit is a rolling window, so pruning one damaged the other, and any change
-- to what gets audited silently changed the limit. Downloads had no limit at
-- all, because there was nothing to count.
--
-- Deny-all RLS, same as auth_attempts: a counter a client can read is a counter
-- a client can plan around, and one a client can write is not a counter.

create table if not exists public.api_usage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null,
  created_at timestamptz not null default now()
);

create index if not exists api_usage_user_endpoint_created_idx
  on public.api_usage (user_id, endpoint, created_at desc);

create index if not exists api_usage_created_at_idx
  on public.api_usage (created_at desc);

alter table public.api_usage enable row level security;

revoke all on table public.api_usage from anon, authenticated;

-- Rows outside every window are pure liability; the application prunes
-- opportunistically, the same way auth_attempts does.
create or replace function public.prune_api_usage()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.api_usage where created_at < now() - interval '24 hours';
$$;

revoke all on function public.prune_api_usage() from public, anon, authenticated;
grant execute on function public.prune_api_usage() to service_role;
