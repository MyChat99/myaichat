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
