-- The default appearance becomes Newsprint light, in the database as well as
-- in the application.
--
-- `DEFAULT_APPEARANCE` moved to `light`/`newsprint` so the signed-out front door
-- is the letterpress look rather than whatever the visitor's OS asks for. The
-- column defaults still said `system`/`riso`, which `verify:appearance` catches
-- for a good reason: a row inserted by the database — a trigger, a backfill,
-- anything not going through the app — would have carried a different default
-- from the one every other path uses, and the disagreement would only show up
-- as one account looking wrong.
--
-- ⚠️ Column defaults apply to NEW rows only. Every existing preference row is
-- deliberately left exactly as it is: these are choices people made, and a
-- migration that "fixes" them would be a migration that overwrites them.
alter table public.user_preferences
  alter column theme set default 'light';

alter table public.user_preferences
  alter column preset_theme set default 'newsprint';
