-- Phase 5 — theming
--
-- Additive only. `user_preferences` has carried theme / accent_color /
-- font_size / bubble_style since Phase 1; this adds the preset-theme axis,
-- which is orthogonal to the accent (the spec asks for six preset themes AND
-- an accent picker, so one column cannot carry both).

alter table public.user_preferences
  add column if not exists preset_theme text not null default 'default';

comment on column public.user_preferences.preset_theme is
  'Named token set: default | midnight | ocean | forest | sunset | rose | mono. Orthogonal to accent_color.';

-- Widen accent_color: Phase 1 stored preset names like ''blue''; it now also
-- holds custom hex values such as ''#7c3aed''.
comment on column public.user_preferences.accent_color is
  'Preset accent name or a #rrggbb hex value.';

-- Validate rather than trust the client. The app writes these through a Zod
-- schema too, but a constraint is what makes a bad value impossible.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_preferences_preset_theme_check'
  ) then
    alter table public.user_preferences
      add constraint user_preferences_preset_theme_check
      check (preset_theme in ('default', 'midnight', 'ocean', 'forest', 'sunset', 'rose', 'mono'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_preferences_accent_color_check'
  ) then
    alter table public.user_preferences
      add constraint user_preferences_accent_color_check
      check (accent_color ~ '^(#[0-9a-fA-F]{6}|[a-z]+)$');
  end if;
end $$;
