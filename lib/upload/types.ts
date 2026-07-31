/**
 * What the app accepts as an attachment.
 *
 * Client-safe on purpose — no `server-only` import — so the composer can reject
 * a file before uploading it while the presign route enforces the same table
 * server-side. **The server is the boundary; this is courtesy.** A client check
 * exists so a 40MB video fails instantly instead of after a round trip, not
 * because it stops anybody.
 *
 * ONE table, imported by both sides. Two copies drift, and the failure mode is
 * the worst kind: the picker accepts a file, the upload starts, and the server
 * rejects it with an error the user cannot act on.
 */

export type AttachmentKind = 'image' | 'document' | 'text';

export const ALLOWED_MIME: Record<string, { ext: string; kind: AttachmentKind }> = {
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'image/gif': { ext: 'gif', kind: 'image' },
  'application/pdf': { ext: 'pdf', kind: 'document' },
  'text/plain': { ext: 'txt', kind: 'text' },
  'text/markdown': { ext: 'md', kind: 'text' },
};

/** For the file picker's `accept`, so the OS dialog filters correctly. */
export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_MIME).join(',');

/** Matches the `.max(5)` on the chat route's attachment array. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** Fallback only. The real cap is `system_settings.max_upload_size_mb`. */
export const FALLBACK_MAX_UPLOAD_MB = 20;

export function describeAccepted(): string {
  // Extensions read better than MIME types in a UI: nobody thinks in
  // "application/pdf", they think in "PDF".
  const exts = [...new Set(Object.values(ALLOWED_MIME).map((v) => v.ext.toUpperCase()))];
  return exts.join(', ');
}

export function isAccepted(mimeType: string): boolean {
  return Boolean(ALLOWED_MIME[mimeType]);
}

export function kindFor(mimeType: string): AttachmentKind | null {
  return ALLOWED_MIME[mimeType]?.kind ?? null;
}

/**
 * Why a file was rejected, phrased for the person who picked it.
 *
 * Returns null when the file is fine. Order matters: type before size, because
 * "we don't take .mov" is more useful than "that's too big" for a 200MB video —
 * shrinking it would not have helped.
 */
export function rejectionReason(
  file: { name: string; type: string; size: number },
  maxBytes: number,
): string | null {
  if (!isAccepted(file.type)) {
    const ext = file.name.split('.').pop()?.toUpperCase();
    return `${ext ? `.${ext.toLowerCase()} files` : 'That file type'} can't be attached. Accepted: ${describeAccepted()}.`;
  }
  if (file.size > maxBytes) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `That file is ${mb}MB. The limit is ${Math.floor(maxBytes / 1024 / 1024)}MB.`;
  }
  if (file.size === 0) {
    return 'That file is empty.';
  }
  return null;
}
