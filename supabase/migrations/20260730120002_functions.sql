-- Phase 1 — helper functions and auth triggers

-- ---------------------------------------------------------------- is_admin
-- SECURITY DEFINER on purpose: an RLS policy on `profiles` that itself queries
-- `profiles` would recurse infinitely. Running as definer skips RLS for this
-- lookup only. Kept minimal — it reads one boolean and nothing else.

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- new user
-- Creates the profile + preference rows when someone signs up.
-- Role is hardcoded to 'user': a client controls its own signup metadata, so
-- reading a role from there would let anyone self-promote to admin.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'user'
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
