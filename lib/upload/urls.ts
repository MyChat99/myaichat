/**
 * URLs for stored objects.
 *
 * **No `'use client'` directive, deliberately, and it must stay that way.**
 *
 * This lived in `lib/upload/client.ts`, which is a client module. Importing a
 * plain function from a client module into a Server Component does not fail at
 * build time and does not fail in `next dev` — it fails only in a production
 * build, at render, with:
 *
 *   Attempted to call attachmentUrl() from the server but attachmentUrl is on
 *   the client.
 *
 * In a production build every export of a `'use client'` module becomes a
 * client *reference* rather than the function itself, so calling it on the
 * server throws. `AvatarMark` is a Server Component and the app shell renders
 * it on every authenticated page — but only calls this when `avatarKey` is
 * set, so the crash appeared exclusively for accounts that had actually
 * uploaded a portrait. Every test account had none, which is why a green suite
 * and a working dev server coexisted with a 500 in production.
 *
 * It is a pure string join with no browser API, so the right home is a module
 * neither side owns.
 */

/** Read an object through our own route, never a bucket URL — the bucket is private. */
export function attachmentUrl(key: string): string {
  return `/api/uploads/download?key=${encodeURIComponent(key)}`;
}

/* ────────────────────────────────────────────────────────────── portraits ── */

/**
 * A portrait is EITHER an uploaded object OR a generated mark, never both.
 *
 * Both live in the single `profiles.avatar_url` column, distinguished by this
 * prefix. One column rather than two because the states are mutually exclusive
 * by definition: two columns would make "uploaded a photo AND chose a mark"
 * representable, and then every read site would need a precedence rule that
 * could disagree with every other read site.
 *
 * The cost is that the column no longer always holds a storage key, and
 * anything that treats it as one is now wrong — `deleteObject(previous)` in the
 * profile actions most of all. `isUploadedKey()` exists for exactly those call
 * sites and they must use it.
 */
const PRESET_PREFIX = 'preset:';

/** How many marks exist. Must equal the number of cases in `PressMark`. */
export const PRESET_COUNT = 8;

export type AvatarSource =
  | { kind: 'upload'; url: string }
  | { kind: 'preset'; index: number };

/** The stored value for a chosen mark. */
export function presetRef(index: number): string {
  return `${PRESET_PREFIX}${((index % PRESET_COUNT) + PRESET_COUNT) % PRESET_COUNT}`;
}

/**
 * Is this stored value a real object in the bucket?
 *
 * The guard for every path that deletes, presigns or downloads. A stored
 * `preset:3` handed to `deleteObject` is at best a wasted round trip and at
 * worst an error surfaced to someone changing their portrait.
 */
export function isUploadedKey(stored: string | null | undefined): stored is string {
  return typeof stored === 'string' && stored.length > 0 && !stored.startsWith(PRESET_PREFIX);
}

/**
 * FNV-1a, so the default mark is the same everywhere without a round trip.
 *
 * It has to be a pure function of the id rather than a stored choice: the whole
 * point is that a user who has never opened Profile still gets a distinct mark,
 * on the server, on the client, and in a fresh browser, with nothing written to
 * the database. A random pick would give the same person a different portrait on
 * every render, and a database default would need a migration to backfill.
 */
export function presetIndexFor(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    // >>> 0 keeps it unsigned; Math.imul does the 32-bit multiply exactly.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % PRESET_COUNT;
}

/**
 * What to draw for this person.
 *
 * Never returns "nothing". With no stored value the id picks a mark, which is
 * the requirement: a reader who has chosen nothing gets something distinctive
 * rather than the generic person glyph.
 */
export function avatarSource(stored: string | null | undefined, seed: string): AvatarSource {
  /*
   * The preset case is tested FIRST, and not for style. `isUploadedKey` is a
   * type predicate (`stored is string`), so testing it first narrows the else
   * branch to `null | undefined` — TypeScript takes the predicate to mean "no
   * string reaches here", which is false: preset references are strings it
   * returns false for. Checking the prefix up front avoids relying on a
   * narrowing that does not hold.
   */
  if (typeof stored === 'string' && stored.startsWith(PRESET_PREFIX)) {
    const parsed = Number.parseInt(stored.slice(PRESET_PREFIX.length), 10);
    // A malformed or out-of-range reference falls back to the seeded mark
    // rather than rendering nothing. The column is not enum-constrained, and a
    // portrait is not worth a 500.
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < PRESET_COUNT) {
      return { kind: 'preset', index: parsed };
    }
  }

  if (isUploadedKey(stored)) return { kind: 'upload', url: attachmentUrl(stored) };

  return { kind: 'preset', index: presetIndexFor(seed) };
}
