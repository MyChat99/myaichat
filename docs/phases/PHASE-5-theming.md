# Phase 5 — Theming & Appearance Customization

## Goal

Users personalize the entire chat experience from the frontend; preferences persist per user and apply instantly.

## Tasks

1. Refactor all colors to CSS custom properties (design tokens: background, surface, surface-hover, border, accent, accent-foreground, text, text-muted) integrated with Tailwind. No hardcoded colors remain in components.
2. Light / Dark / System mode with smooth animated cross-fade; no flash of wrong theme on load (SSR-safe).
3. Accent color picker: 8+ presets + custom hex/HSL input with live preview.
4. Six preset themes minimum (Midnight, Ocean, Forest, Sunset, Rose, Mono), each a token set — themes are data, not code.
5. Font size control (S/M/L) and chat bubble style toggle (bubbles vs flat/document).
6. Settings surface: a polished appearance panel (modal or /settings page) with live preview.
7. Persist to `user_preferences`; load on session start; apply instantly without reload.
8. Verify WCAG AA contrast for every theme in both modes; respect prefers-reduced-motion.

## Acceptance criteria

- Theme, accent, font size, bubble style all persist across refresh and devices
- No flash of unstyled/wrong theme; all themes pass AA contrast on primary text
- lint + type-check + build pass
