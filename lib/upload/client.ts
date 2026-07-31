'use client';

/**
 * Browser-side upload helper.
 *
 * Two steps by design: ask our server to presign (which is where auth, type
 * and size are enforced), then PUT the bytes straight to R2. The file never
 * passes through our server, so a large upload does not occupy a Node process.
 */

export type PendingAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'image' | 'document' | 'text';
  key?: string;
  progress: number;
  error?: string;
  /** Object URL for the local thumbnail; revoked when removed. */
  previewUrl?: string;
};

export type UploadOutcome =
  | { ok: true; key: string; kind: 'image' | 'document' | 'text' }
  | { ok: false; error: string; unconfigured?: boolean };

export async function uploadFile(
  file: File,
  scope: 'chat' | 'avatar' = 'chat',
): Promise<UploadOutcome> {
  const presignResponse = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      scope,
    }),
  });

  const presigned = await presignResponse.json().catch(() => null);

  if (!presignResponse.ok) {
    return {
      ok: false,
      error: presigned?.error ?? 'Upload could not be prepared.',
      unconfigured: presigned?.code === 'storage_unconfigured',
    };
  }

  // Content-Type must match what was signed, or R2 rejects the PUT.
  const put = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });

  if (!put.ok) return { ok: false, error: 'Upload failed.' };

  return { ok: true, key: presigned.key, kind: presigned.kind };
}

/** URL for reading an object — always through our route, never the bucket. */
export function attachmentUrl(key: string): string {
  return `/api/uploads/download?key=${encodeURIComponent(key)}`;
}
