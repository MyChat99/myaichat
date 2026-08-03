# Performance — railway-after

CPU throttle **4×**, 60 conversations in the sidebar, 30 messages in the open thread, 1440×900, cache cleared per route. **Median of 5**, after a discarded warm-up.

| route | TTFB | FCP | LCP | DOM interactive | long tasks | longest | TBT | transfer KB | DOM nodes |
|---|---|---|---|---|---|---|---|---|---|
| chat (empty) | 695 | 848 | 848 | 834 | 0 | 0 | 0 | 51 | 1166 |
| chat (30 msgs) | 507 | 676 | 676 | 980 | 0 | 0 | 0 | 51 | 1589 |
| compare | 574 | 724 | 724 | 680 | 0 | 0 | 0 | 51 | 1115 |
| settings | 514 | 684 | 684 | 652 | 0 | 0 | 0 | 51 | 1236 |
| admin | 1201 | 1356 | 1356 | 1342 | 0 | 0 | 0 | 51 | 1166 |

## Client-side navigation (already loaded)

| from → to | ms |
|---|---|
| chat → presses | 855 |
| presses → appearance | 52 |
| appearance → chat | 829 |

## While an answer streams

- wall clock: **6.4s**
- React commits: **not measurable in a production build**
- long tasks during the stream: **0**, longest **0ms**, blocking **0ms**

**Worst route by blocking time:** admin — 0ms across 0 long tasks, 1166 DOM nodes.

Measured 2026-08-03T04:33:10.046Z against https://myaichat-production.up.railway.app.
