# Performance — railway-before

CPU throttle **4×**, 60 conversations in the sidebar, 30 messages in the open thread, 1440×900, cache cleared per route. **Median of 5**, after a discarded warm-up.

| route | TTFB | FCP | LCP | DOM interactive | long tasks | longest | TBT | transfer KB | DOM nodes |
|---|---|---|---|---|---|---|---|---|---|
| chat (empty) | 1160 | 1308 | 1308 | 1283 | 0 | 0 | 0 | 51 | 1166 |
| chat (30 msgs) | 524 | 716 | 716 | 1596 | 0 | 0 | 0 | 51 | 1589 |
| compare | 581 | 748 | 748 | 702 | 0 | 0 | 0 | 51 | 1115 |
| settings | 602 | 752 | 752 | 706 | 0 | 0 | 0 | 51 | 1236 |
| admin | 1754 | 1908 | 1908 | 1893 | 0 | 0 | 0 | 51 | 1166 |

## Client-side navigation (already loaded)

| from → to | ms |
|---|---|
| chat → presses | 846 |
| presses → appearance | 57 |
| appearance → chat | 1332 |

## While an answer streams

- wall clock: **9.4s**
- React commits: **not measurable in a production build**
- long tasks during the stream: **0**, longest **0ms**, blocking **0ms**

**Worst route by blocking time:** admin — 0ms across 0 long tasks, 1166 DOM nodes.

Measured 2026-08-03T04:17:56.231Z against https://myaichat-production.up.railway.app.
