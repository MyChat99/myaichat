-- Devices an account has signed in from before.
--
-- Exists so a "new login" alert can mean something. Alerting on EVERY sign-in
-- trains the recipient to delete the mail unread, which is worse than not
-- sending it: the one that matters then looks like the ninety before it.
--
-- `fingerprint` is an HMAC of (ip + user-agent) keyed by ENCRYPTION_MASTER_KEY.
-- Storing the raw values would turn this into a log of where an administrator
-- physically is, which is a worse thing to hold than the problem it solves.
--
-- Deny-all RLS, service-role only — same reasoning as auth_attempts and
-- api_usage.

create table if not exists public.known_logins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index if not exists known_logins_user_last_seen_idx
  on public.known_logins (user_id, last_seen desc);

alter table public.known_logins enable row level security;

revoke all on table public.known_logins from anon, authenticated;
