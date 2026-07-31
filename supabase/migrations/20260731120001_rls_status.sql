-- Security audit support
--
-- Exposes RLS coverage from the pg catalog so `npm run security:audit` can
-- verify actual database state rather than inferring it from migration files.
-- A migration that forgot `enable row level security` still LOOKS correct in
-- the file; only the catalog knows the truth.
--
-- Admin-only: the list of tables and their protection status is exactly the
-- reconnaissance an attacker would want.

create or replace function public.rls_status()
returns table (table_name text, rls_enabled boolean, policy_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    (select count(*) from pg_policy p where p.polrelid = c.oid)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
  order by c.relname;
$$;

revoke all on function public.rls_status() from public, anon, authenticated;
grant execute on function public.rls_status() to service_role;

comment on function public.rls_status() is
  'RLS coverage per public table. service_role only — used by scripts/security-audit.ts.';
