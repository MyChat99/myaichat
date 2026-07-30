-- Fixes the profile UPDATE policy.
--
-- The original policy tried to pin `role` with a WITH CHECK subquery against
-- public.profiles. A policy ON profiles that SELECTs FROM profiles re-enters
-- the same policy set, so Postgres aborted with 42P17 (infinite recursion) on
-- EVERY profile update by a normal user — including legitimate display_name
-- changes. It blocked privilege escalation only by failing outright.
--
-- Note that public.is_admin() does NOT recurse here: it is SECURITY DEFINER and
-- owned by the table owner, so its internal read bypasses RLS. The bug was the
-- bare subquery, not the helper.
--
-- The column is now pinned by a BEFORE UPDATE trigger, which is the right tool
-- for "this column may not change" — RLS decides which ROWS you may touch.

drop policy if exists "profiles: update own non-role fields" on public.profiles;

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Not SECURITY DEFINER: we want current_user to reflect the real caller so the
-- service_role escape hatch below is meaningful. is_admin() supplies the
-- privileged lookup on its own.
create or replace function public.enforce_profile_role_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    -- The secret key (service_role) may set roles: that is how seeding and the
    -- Phase 4 admin panel promote users. An existing admin may too.
    if current_user = 'service_role' or public.is_admin() then
      return new;
    end if;

    -- Anyone else: silently keep the old role. Reverting rather than raising
    -- avoids handing a prober a signal that the column is interesting.
    new.role := old.role;
  end if;

  return new;
end;
$$;

create trigger profiles_role_guard
  before update on public.profiles
  for each row execute function public.enforce_profile_role_guard();
