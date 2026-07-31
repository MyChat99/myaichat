import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Cloudflare R2 object storage (S3-compatible).
 *
 * The bucket stays PRIVATE. Nothing here ever returns a public URL — uploads
 * and downloads both go through short-lived presigned URLs, which is what makes
 * "direct bucket URLs do not work" true rather than aspirational.
 *
 * ⚠️ NOT CONFIGURED IN THIS ENVIRONMENT. `isStorageConfigured()` is the single
 * flag; callers must check it and degrade rather than throwing at users. See
 * ISSUES.md ISSUE-016 for exactly which variables to add.
 */

const UPLOAD_URL_TTL_SECONDS = 60 * 5; // long enough to upload, short enough to be useless if leaked
const DOWNLOAD_URL_TTL_SECONDS = 60 * 10;

/** Allow-list, not a block-list: anything not named here is refused. */
export const ALLOWED_MIME: Record<string, { ext: string; kind: 'image' | 'document' | 'text' }> = {
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'image/gif': { ext: 'gif', kind: 'image' },
  'application/pdf': { ext: 'pdf', kind: 'document' },
  'text/plain': { ext: 'txt', kind: 'text' },
  'text/markdown': { ext: 'md', kind: 'text' },
};

export type AttachmentKind = 'image' | 'document' | 'text';

export type StoredAttachment = {
  key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
};

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME,
  );
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!isStorageConfigured()) {
    throw new Error('R2 is not configured. See ISSUES.md ISSUE-016.');
  }

  if (!client) {
    client = new S3Client({
      // R2 ignores region but the SDK requires one.
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  return client;
}

function bucket(): string {
  return process.env.R2_BUCKET_NAME!;
}

/**
 * Builds the object key.
 *
 * The user id prefix is deliberate: it makes per-user access checks a string
 * comparison, and it means a leaked key cannot be walked upward to another
 * user's files. The random component prevents guessing a filename.
 */
export function buildObjectKey(userId: string, scope: 'chat' | 'avatar', filename: string): string {
  const mime = Object.entries(ALLOWED_MIME).find(([, v]) => filename.toLowerCase().endsWith(v.ext));
  const ext = mime?.[1].ext ?? 'bin';
  return `${scope}/${userId}/${randomUUID()}.${ext}`;
}

/** True when this key belongs to this user. Cheap, and the reason for the prefix. */
export function keyBelongsToUser(key: string, userId: string): boolean {
  return key.startsWith(`chat/${userId}/`) || key.startsWith(`avatar/${userId}/`);
}

export async function presignUpload(
  key: string,
  mimeType: string,
  sizeBytes: number,
): Promise<string> {
  // ContentLength is signed in, so the URL cannot be reused to upload something
  // larger than what was validated.
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: mimeType,
    ContentLength: sizeBytes,
  });

  return getSignedUrl(getClient(), command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
}

export async function presignDownload(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket(), Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

/** Fetches an object's bytes server-side, for passing to a model. */
export async function fetchObject(key: string): Promise<{ base64: string; mimeType: string }> {
  const response = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));

  const bytes = await response.Body!.transformToByteArray();
  return {
    base64: Buffer.from(bytes).toString('base64'),
    mimeType: response.ContentType ?? 'application/octet-stream',
  };
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
