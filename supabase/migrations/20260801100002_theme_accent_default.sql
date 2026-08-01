-- Default the accent to 'theme' — follow the preset's own ink rather than
-- painting over it.
--
-- The previous default, 'blue', resolved to #1d4ed8 in BOTH modes. Combined
-- with the Riso default from the previous migration, that produced a theme with
-- a deliberate identity — Federal Blue on paper, Fluorescent Pink at night —
-- rendered with a generic Tailwind blue over the top, in both modes. The two
-- colours that make Riso recognisable never appeared for anyone who had not
-- gone into settings.
--
-- 'theme' is a plain lowercase word, so the existing accent_color CHECK
-- (^(#[0-9a-fA-F]{6}|[a-z]+)$) already admits it — no constraint change. It
-- resolves to NULL in accentToHex(), and withAccent(tokens, null) returns the
-- theme's tokens untouched, so each mode keeps its own accent.
--
-- ⚠️ As with the theme default: this changes what NEW rows get. Anyone who has
-- already chosen an accent keeps it.

alter table public.user_preferences
  alter column accent_color set default 'theme';

comment on column public.user_preferences.accent_color is
  'Accent: ''theme'' to follow the preset''s own per-mode accent, a named preset (blue, violet, …), or a #rrggbb value.';
