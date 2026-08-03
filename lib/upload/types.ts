/**
 * What the app accepts as an attachment, and how each type reaches the model.
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

/**
 * How the bytes get in front of the model. This is a *delivery* taxonomy, not a
 * file taxonomy, because delivery is the only thing the rest of the code has to
 * branch on:
 *
 *   image     sent natively as an image part. Needs a vision model.
 *   document  sent natively as a document part. Needs a document-capable model.
 *   text      decoded as UTF-8 and inlined. Any model can read it.
 *   office    unzipped and extracted server-side, then inlined. Any model.
 *
 * `text` and `office` differ only in how the text is obtained, and they are kept
 * apart because one is a decode and the other is a parse that can fail.
 */
export type AttachmentKind = 'image' | 'document' | 'text' | 'office';

export type AcceptedType = {
  ext: string;
  kind: AttachmentKind;
  /** Shown on the chip. Short enough to survive a 360px screen. */
  label: string;
};

export const ALLOWED_MIME: Record<string, AcceptedType> = {
  'image/png': { ext: 'png', kind: 'image', label: 'PNG' },
  'image/jpeg': { ext: 'jpg', kind: 'image', label: 'JPEG' },
  'image/webp': { ext: 'webp', kind: 'image', label: 'WebP' },
  'image/gif': { ext: 'gif', kind: 'image', label: 'GIF' },
  'application/pdf': { ext: 'pdf', kind: 'document', label: 'PDF' },
  'text/plain': { ext: 'txt', kind: 'text', label: 'Text' },
  'text/markdown': { ext: 'md', kind: 'text', label: 'Markdown' },
  'text/csv': { ext: 'csv', kind: 'text', label: 'CSV' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    kind: 'office',
    label: 'Word',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: 'xlsx',
    kind: 'office',
    label: 'Sheet',
  },
};

/**
 * Extension fallback, used ONLY when the browser gives us nothing usable.
 *
 * `.md` arrives as `text/markdown` on one machine and `''` on another; `.csv`
 * arrives as `text/csv`, `text/plain`, or `application/vnd.ms-excel` depending
 * on whether Excel is installed. Refusing those is a bug the user cannot
 * diagnose from the message.
 *
 * This is a convenience for the picker. It never widens what the server
 * accepts — the server re-derives the type from the bytes themselves.
 */
const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'application/vnd.ms-excel']);

const BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(ALLOWED_MIME).map(([mime, v]) => [v.ext, mime]),
);

/** The MIME type we will treat this file as, or null if we take no such file. */
export function resolveMime(file: { name: string; type: string }): string | null {
  const declared = file.type.trim().toLowerCase();
  if (ALLOWED_MIME[declared]) return declared;
  if (!GENERIC_TYPES.has(declared)) return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? null;
}

/** For the file picker's `accept`, so the OS dialog filters correctly. */
export const ACCEPT_ATTRIBUTE = [
  ...Object.keys(ALLOWED_MIME),
  ...Object.values(ALLOWED_MIME).map((v) => `.${v.ext}`),
].join(',');

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

export function labelFor(mimeType: string): string {
  return ALLOWED_MIME[mimeType]?.label ?? 'File';
}

/**
 * Which model capability a kind requires.
 *
 * `text` and `office` require nothing: by the time they reach a provider they
 * are ordinary text in the prompt. That is the entire point of extraction — it
 * turns a file most models would refuse into one every model can read.
 */
export function requiredCapability(kind: AttachmentKind): 'vision' | 'documents' | null {
  if (kind === 'image') return 'vision';
  if (kind === 'document') return 'documents';
  return null;
}

export type ModelCapability = {
  displayName: string;
  supportsVision: boolean;
  supportsDocuments: boolean;
};

/**
 * Why this model cannot take this file, phrased for the person holding it —
 * and always naming something they can do instead.
 * Returns null when the pairing is fine.
 */
export function capabilityRefusal(mimeType: string, model: ModelCapability): string | null {
  const kind = kindFor(mimeType);
  if (!kind) return null;
  const needs = requiredCapability(kind);
  if (needs === 'vision' && !model.supportsVision) {
    return `${model.displayName} can't read images. Choose a vision model, or attach a document instead.`;
  }
  if (needs === 'documents' && !model.supportsDocuments) {
    return `${model.displayName} can't read PDFs. Choose a document-capable model, or paste the text.`;
  }
  return null;
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
  if (!resolveMime(file)) {
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
