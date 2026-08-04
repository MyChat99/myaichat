import { randomBytes } from 'node:crypto';

import { z } from 'zod';

/**
 * Signup password rules.
 *
 * Follows NIST SP 800-63B rather than the familiar composition rules: length
 * and a blocklist, not "one uppercase, one digit, one symbol". Composition
 * rules reliably produce `Password1!` — they push users toward a small, highly
 * predictable region of the keyspace while feeling strict. Length plus a
 * blocklist of what attackers actually try is the guidance that replaced them.
 *
 * ⚠️ These rules apply at SIGNUP ONLY. The login schema still accepts the old
 * 8-character minimum, because raising the minimum on the *login* path would
 * lock out every existing account whose password is shorter — a validation
 * error before the password is ever checked, with no way for the user to fix
 * it. Existing users are migrated by a password reset, not by a rejection.
 */

export const MIN_PASSWORD_LENGTH = 10;
/** bcrypt truncates past 72 bytes; anything beyond is silently ignored. */
export const MAX_PASSWORD_LENGTH = 72;

/**
 * The passwords that actually show up in credential-stuffing lists. Short by
 * design — a real breach corpus belongs behind a k-anonymity API, and this is
 * the offline stand-in that costs nothing and catches the worst of it.
 *
 * Compared case-insensitively and after stripping trailing digits, so `Summer2024`
 * and `password123` are caught by `summer` and `password`.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'passw0rd',
  'p@ssword',
  'p@ssw0rd',
  'qwerty',
  'qwertyuiop',
  'azerty',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'superman',
  'trustno',
  'abc',
  'abcdef',
  'abcdefg',
  'abcd',
  'test',
  'testing',
  'summer',
  'winter',
  'spring',
  'autumn',
  'january',
  'changeme',
  'secret',
  'master',
  'shadow',
  'ninja',
  'access',
  'flower',
  'hello',
  'freedom',
  'whatever',
  'starwars',
  'computer',
  'internet',
  'chatgpt',
  'openai',
  'anthropic',
  'claude',
  'myaichat',
]);

/** `Summer2024!` → `summer` */
function normalise(password: string): string {
  return password
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/\d+$/, '');
}

export function isCommonPassword(password: string): boolean {
  const base = normalise(password);
  if (!base) return true; // digits and punctuation only — nothing to remember but nothing to guess either
  return COMMON_PASSWORDS.has(base);
}

/** `aaaaaaaaaa`, `1111111111`, `abababab` — long, and worthless. */
export function isLowEntropy(password: string): boolean {
  const distinct = new Set(password).size;
  if (distinct <= 3) return true;

  // Any string built by repeating a short unit, e.g. "abcabcabcabc".
  for (let unit = 1; unit <= password.length / 3; unit++) {
    const head = password.slice(0, unit);
    if (head.repeat(Math.ceil(password.length / unit)).slice(0, password.length) === password) {
      return true;
    }
  }

  return false;
}

/** Rejects `alice@example.com` / `alice1234` — the first thing anyone tries. */
export function containsEmailLocalPart(password: string, email: string): boolean {
  const local =
    email
      .trim()
      .toLowerCase()
      .split('@')[0]
      ?.replace(/[^a-z0-9]/g, '') ?? '';
  if (local.length < 4) return false;
  return password
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .includes(local);
}

export const strongPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`)
  .refine(
    (p) => !isCommonPassword(p),
    'That password is too common — pick something less guessable',
  )
  .refine(
    (p) => !isLowEntropy(p),
    'That password is too repetitive — pick something less guessable',
  );

/**
 * The email-aware check cannot live in the schema above, which sees only the
 * password field, so it runs as a second pass over the whole object.
 */
export const signUpPasswordSchema = z
  .object({ email: z.string(), password: strongPasswordSchema })
  .refine((v) => !containsEmailLocalPart(v.password, v.email), {
    message: 'Password must not contain your email address',
    path: ['password'],
  });

/**
 * A passphrase for an account an administrator is handing over in person.
 *
 * Four words and four digits: long enough to pass `strongPasswordSchema`, short
 * enough to read down a phone line, which is how one of these actually gets
 * delivered. `randomBytes`, never `Math.random` — the latter is seeded
 * predictably and has no business near a credential.
 *
 * Server-side and shared by account creation and password reset, so there is
 * one definition of what a handed-over password looks like rather than one per
 * call site drifting apart.
 */
export function generatePassphrase(): string {
  const bytes = randomBytes(5);
  const pick = (i: number) => PASSPHRASE_WORDS[bytes[i] % PASSPHRASE_WORDS.length];
  const digits = String(((bytes[3] << 8) | bytes[4]) % 10_000).padStart(4, '0');
  return `${pick(0)}-${pick(1)}-${pick(2)}-${digits}`;
}

const PASSPHRASE_WORDS = [
  'press',
  'ink',
  'paper',
  'plate',
  'folio',
  'quire',
  'signature',
  'proof',
  'galley',
  'stone',
  'roller',
  'type',
  'margin',
  'gutter',
  'rule',
  'stock',
];
