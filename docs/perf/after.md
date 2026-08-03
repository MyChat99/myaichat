# Performance — after

CPU throttle **4×**, 60 conversations in the sidebar, 30 messages in the open thread, 1440×900, cache cleared per route. **Median of 5**, after a discarded warm-up.

| route | TTFB | FCP | LCP | DOM interactive | long tasks | longest | TBT | transfer KB | DOM nodes |
|---|---|---|---|---|---|---|---|---|---|
| chat (empty) | 385 | 468 | 468 | 461 | 0 | 0 | 0 | 51 | 1166 |
| chat (30 msgs) | 137 | 208 | 208 | 606 | 0 | 0 | 0 | 51 | 1589 |
| compare | 154 | 252 | 252 | 219 | 0 | 0 | 0 | 51 | 1115 |
| settings | 143 | 228 | 228 | 193 | 0 | 0 | 0 | 51 | 1236 |
| admin | 462 | 548 | 548 | 534 | 0 | 0 | 0 | 51 | 1166 |

## Client-side navigation (already loaded)

| from → to | ms |
|---|---|
| chat → presses | 281 |
| presses → appearance | 92 |
| appearance → chat | 828 |

## While an answer streams

- wall clock: **6.4s**
- React commits: **not measurable in a production build**
- long tasks during the stream: **0**, longest **0ms**, blocking **0ms**

**Worst route by blocking time:** admin — 0ms across 0 long tasks, 1166 DOM nodes.

Measured 2026-08-03T04:11:07.378Z against http://localhost:3100.
