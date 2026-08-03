-- Editions: a gathering of pages.
--
-- A page (conversation) belongs to at most one edition. Deleting an edition
-- must NOT delete its pages — they come loose, and they must come loose exactly
-- where they were, under their original date heading in the sidebar.
--
-- That last requirement is the whole reason this migration is more than two
-- statements. See the trigger section at the bottom.

-- ---------------------------------------------------------------- editions

create table public.editions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Trimmed length, so a name of nothing but spaces cannot be stored. Zod
  -- enforces the same bound at the route; this is the copy that holds when
  -- something reaches the table by another path.
  constraint editions_name_not_blank check (length(btrim(name)) between 1 and 80)
);

comment on table public.editions is
  'A user-owned grouping of conversations. Deleting one releases its conversations rather than deleting them.';

create index editions_user_idx on public.editions (user_id, created_at desc);

create trigger editions_set_updated_at
  before update on public.editions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- membership

-- ON DELETE SET NULL is the requirement, stated in the schema: deleting an
-- edition releases its pages. Doing it in the database rather than in the
-- delete handler means it holds for every path — including the ones that do not
-- exist yet.
alter table public.conversations
  add column edition_id uuid references public.editions (id) on delete set null;

comment on column public.conversations.edition_id is
  'At most one edition. Nulled — never cascaded — when the edition is deleted.';

create index conversations_edition_idx
  on public.conversations (edition_id)
  where edition_id is not null;

-- ---------------------------------------------------------------- RLS

alter table public.editions enable row level security;

-- Same shape as "conversations: own rows", deliberately. A user reaches their
-- own editions and no others, enforced in the database and not only in the
-- server action that happens to be the caller today.
create policy "editions: own rows"
  on public.editions for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- RLS on `editions` stops a user reading or writing someone else's edition. It
-- does NOT stop them writing a foreign edition's id onto their own conversation
-- — that write is against `conversations`, a row they legitimately own, and the
-- existing policy has no opinion about the value of this column.
--
-- Enforced with a trigger rather than a foreign-key-plus-policy because it must
-- also hold for the service role, which bypasses RLS entirely and is what every
-- server action in this app uses.
create or replace function public.conversation_edition_owned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.edition_id is not null
     and not exists (
       select 1 from public.editions e
        where e.id = new.edition_id
          and e.user_id = new.user_id
     )
  then
    raise exception 'edition % does not belong to the owner of this conversation', new.edition_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger conversations_edition_owned
  before insert or update of edition_id, user_id on public.conversations
  for each row execute function public.conversation_edition_owned();

-- ---------------------------------------------------------------- updated_at

-- ⚠️ THE POINT OF THIS MIGRATION.
--
-- The sidebar groups pages under date headings by `conversations.updated_at`
-- (components/chat/sidebar.tsx) and orders by it (lib/db/conversations.ts).
--
-- `conversations_set_updated_at` fires BEFORE UPDATE FOR EACH ROW and does
-- `new.updated_at = now()` unconditionally. So every write to the row restamps
-- it — including the `ON DELETE SET NULL` above, which is an UPDATE.
--
-- Left alone, deleting an edition would move every one of its pages to "Today"
-- and destroy the real history. Assigning a page to an edition would do the
-- same. The feature would look like it worked and would quietly rewrite the
-- reader's timeline.
--
-- So the trigger no longer fires when the ONLY thing that changed is membership.
-- Expressed as "everything except these columns is unchanged" rather than by
-- listing the columns that should restamp: a column added next year would
-- silently stop restamping under the second form, and this way it restamps by
-- default and stays still only for the case we have reasoned about.
--
-- `updated_at` itself is excluded from the comparison so that a caller setting
-- it explicitly — the chat route does, on each new message — is not treated as
-- "a real change" and then overwritten with now(). The explicit value stands.
drop trigger if exists conversations_set_updated_at on public.conversations;

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row
  when (
    (to_jsonb(old) - 'edition_id' - 'updated_at')
    is distinct from
    (to_jsonb(new) - 'edition_id' - 'updated_at')
  )
  execute function public.set_updated_at();
