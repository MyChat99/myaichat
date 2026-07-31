import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM for provider API keys at rest.
 *
 * Ciphertext format: `v1.<iv>.<authTag>.<ciphertext>`, each part base64url.
 * The version prefix exists so a future algorithm change can be rolled out by
 * reading both formats and re-encrypting on write, rather than a flag day.
 *
 * GCM is authenticated: tampering with the stored value makes decryption throw
 * rather than silently returning corrupted plaintext.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const KEY_BYTES = 32;

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_MASTER_KEY is not set. Generate one: openssl rand -base64 32');
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_MASTER_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. Generate one: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new Error('Refusing to encrypt an empty secret.');

  // A fresh random IV per encryption. Reusing an IV under the same key breaks
  // GCM catastrophically — never derive it from anything deterministic.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Stored secret is not in a recognised format.');
  }

  const [, ivPart, tagPart, ctPart] = parts;
  const decipher = createDecipheriv(ALGORITHM, masterKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  // Throws on a bad tag — i.e. wrong master key or tampered ciphertext.
  return Buffer.concat([
    decipher.update(Buffer.from(ctPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Last 4 characters, for the masked display. Never store more than this. */
export function keyLast4(plaintext: string): string {
  return plaintext.slice(-4);
}

/** `sk-ant-…a1b2` — what the admin UI shows in place of a key. */
export function maskKey(prefix: string | null, last4: string | null): string {
  if (!last4) return 'Not set';
  return `${prefix ?? 'sk'}-…${last4}`;
}

/** Constant-time compare, for anywhere a secret is checked against user input. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
