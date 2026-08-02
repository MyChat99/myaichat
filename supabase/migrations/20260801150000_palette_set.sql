-- Replace the palette set.
--
-- The old set was eight variations on "near-white paper, one mid-tone accent",
-- which made them a hue rotation rather than seven identities. The new set
-- gives each palette two contrasting inks and its own stock. Five ids go away
-- and two arrive, so this is not only a data change — the CHECK constraint is
-- what makes a bad value impossible, and rows already holding a retired id
-- would be left un-renderable.
--
-- ⚠️ THIS ONE DOES TOUCH EXISTING ROWS, unlike the theme migrations before it.
-- It has to: a preference pointing at a palette that no longer exists is not a
-- preference, it is a broken row. Every retired id is mapped to the nearest
-- surviving one by stock and ink temperature rather than defaulting everyone
-- back to Riso, so a choice that was made is approximated instead of discarded:
--
--   default  → newsprint   neutral, high contrast, black ink
--   midnight → blueprint   deep blue
--   ocean    → blueprint   the only other cyan-leaning palette
--   forest   → botanical   green ink on warm stock
--   sunset   → pulp        warm stock, orange ink
--   rose     → pulp        kept warm and light rather than sent to Neon, which
--                          is near-black and would be a shock, not a migration
--   mono     → mono        survives, redesigned
--   riso     → riso        unchanged
--
-- Order matters: the constraint has to come off BEFORE the rows are rewritten,
-- because the new values violate the old constraint.

alter table public.user_preferences
  drop constraint if exists user_preferences_preset_theme_check;

update public.user_preferences
set preset_theme = case preset_theme
  when 'default' then 'newsprint'
  when 'midnight' then 'blueprint'
  when 'ocean' then 'blueprint'
  when 'forest' then 'botanical'
  when 'sunset' then 'pulp'
  when 'rose' then 'pulp'
  else preset_theme
end
where preset_theme in ('default', 'midnight', 'ocean', 'forest', 'sunset', 'rose');

alter table public.user_preferences
  add constraint user_preferences_preset_theme_check
  check (
    preset_theme in ('riso', 'newsprint', 'blueprint', 'pulp', 'neon', 'botanical', 'mono')
  );

comment on column public.user_preferences.preset_theme is
  'Palette id. Supplies colour only — the layout is the same for every palette (see app/press.css and verify:structure).';
