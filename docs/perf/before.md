# Performance — before

CPU throttle **4×**, 60 conversations in the sidebar, 30 messages in the open thread, 1440×900, cache cleared per route. **Median of 5**, after a discarded warm-up.

| route | TTFB | FCP | LCP | DOM interactive | long tasks | longest | TBT | transfer KB | DOM nodes |
|---|---|---|---|---|---|---|---|---|---|
| chat (empty) | 380 | 460 | 460 | 449 | 0 | 0 | 0 | 51 | 1166 |
| chat (30 msgs) | 148 | 228 | 228 | 602 | 0 | 0 | 0 | 51 | 1589 |
| compare | 163 | 244 | 244 | 224 | 0 | 0 | 0 | 51 | 1115 |
| settings | 138 | 220 | 220 | 210 | 0 | 0 | 0 | 51 | 1236 |
| admin | 486 | 568 | 568 | 560 | 0 | 0 | 0 | 51 | 1166 |

## Client-side navigation (already loaded)

| from → to | ms |
|---|---|
| chat → presses | 260 |
| presses → appearance | 85 |
| appearance → chat | 825 |

## While an answer streams

- wall clock: **4.9s**
- React commits: **not measurable in a production build**
- long tasks during the stream: **0**, longest **0ms**, blocking **0ms**

**Worst route by blocking time:** admin — 0ms across 0 long tasks, 1166 DOM nodes.

Measured 2026-08-03T04:14:05.279Z against http://localhost:3100.
