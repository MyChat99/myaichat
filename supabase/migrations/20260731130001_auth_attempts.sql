-- Login / re-authentication throttling.
--
-- Additive: one new table, no existing object is altered.
--
-- `identifier` is NEVER a raw email. The application stores an HMAC of the
-- lowercased email keyed by ENCRYPTION_MASTER_KEY, so this table cannot be
-- harvested for a list of registered addresses if it is ever exposed, and two
-- attempts for the same address still collide onto the same key for counting.
--
-- No policies are defined on purpose. RLS is enabled and the table is revoked
-- from anon/authenticated, so the only route in is the service_role key used by
-- the server-side throttle. A throttle a client can read is a throttle a client
-- can plan around; a throttle a client can write is not a throttle.

create table if not exists public.auth_attempts (
  id          uuid primary key default gen_random_uuid(),
  identifier  text not null,
  kind        text not null check (kind in ('login', 'reauth')),
  succeeded   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists auth_attempts_identifier_created_at_idx
  on public.auth_attempts (identifier, created_at desc);

create index if not exists auth_attempts_created_at_idx
  on public.auth_attempts (created_at desc);

alter table public.auth_attempts enable row level security;

revoke all on table public.auth_attempts from anon, authenticated;

-- Housekeeping. Attempts older than a day are useless for throttling and are
-- only a liability to keep, so the application prunes opportunistically.
create or replace function public.prune_auth_attempts()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.auth_attempts where created_at < now() - interval '24 hours';
$$;

revoke all on function public.prune_auth_attempts() from public, anon, authenticated;
grant execute on function public.prune_auth_attempts() to service_role;
