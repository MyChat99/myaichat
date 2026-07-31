# Screenshots

Drop captures here and swap the placeholder table in the root README for real
image tags.

Suggested set, in this order:

The authoritative spec — which screen, in which state — is the Screenshots
table in the root [README](../../README.md). Kept there because that is where a
reader meets it. Filenames must match:

| File | Screen |
| --- | --- |
| `chat.png` | `/` or `/c/<id>`, mid-stream |
| `themes.png` | `/settings`, non-default preset |
| `admin-providers.png` | `/admin/providers`, after Test connection |
| `admin-analytics.png` | `/admin/analytics`, 30-day range |

Practical notes:

- **1600×1000** at 2× is a good size — legible on GitHub, not enormous in the repo.
- Capture in a **non-default theme**. The default looks like every other app; the
  point of the theming work is that it does not have to.
- **Seed demo data first** so the analytics charts are not three flat lines:
  `npm run seed -- --demo` (see `scripts/seed.ts`).
- Check nothing sensitive is on screen: a real key suffix is fine (only the last
  four are ever rendered), but check the account email in the header if you would
  rather it were not public.
