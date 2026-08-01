-- Adds 'riso' to the allowed preset themes, and makes it the default for new
-- rows.
--
-- The check constraint is what makes a bad value impossible, so a new theme is
-- not just a data change in presets.ts — without this, choosing Riso would be
-- rejected by Postgres with a constraint violation the UI could not explain.
--
-- ⚠️ EXISTING PREFERENCES ARE NOT TOUCHED. Changing a column default affects
-- rows inserted afterwards, never rows already there — anyone who has chosen a
-- theme keeps it. That is the intent: a new default is for people who have not
-- expressed a preference, and silently restyling someone's app because the
-- product changed its mind is not a default, it is an override.

alter table public.user_preferences
  drop constraint if exists user_preferences_preset_theme_check;

alter table public.user_preferences
  add constraint user_preferences_preset_theme_check
  check (preset_theme in ('default', 'riso', 'midnight', 'ocean', 'forest', 'sunset', 'rose', 'mono'));

alter table public.user_preferences
  alter column preset_theme set default 'riso';
