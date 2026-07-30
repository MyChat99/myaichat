# Phase 7 — Analytics, Audit Log UI, Animations & Polish

## Goal
The admin gets full visibility; the app reaches "award-winning" fit and finish.

## Tasks
1. Admin Analytics dashboard (Recharts): messages/day, tokens by model, estimated cost by provider, active users — with date-range filter. Aggregate from usage_logs with efficient queries.
2. Admin Audit Log page: filterable, paginated table (actor, action, target, IP, time).
3. Animation pass (Framer Motion): sidebar slide, message entrance (fade + rise), theme cross-fade, button micro-interactions, skeleton loaders while streams initialize. All gated by prefers-reduced-motion.
4. Command palette (Cmd/Ctrl+K): new chat, search conversations, switch model, open settings. Keyboard shortcuts documented in a help modal.
5. Toast notifications (sonner) for all async outcomes; consistent empty states and error boundaries everywhere.
6. Security hardening pass: CSP, HSTS, X-Frame-Options, X-Content-Type-Options headers; dependency audit; confirm no secret ever logs.
7. Performance pass: route-level code splitting, image optimization, memoized message list (virtualize if long). Target Lighthouse ≥90 performance, ≥95 accessibility.
8. Full accessibility audit: keyboard-only walkthrough of chat + admin, focus rings, ARIA labels.

## Acceptance criteria
- Dashboards render real data and stay fast with 10k+ usage rows
- Lighthouse targets met on chat page; keyboard-only operation possible end-to-end
- lint + type-check + build pass
