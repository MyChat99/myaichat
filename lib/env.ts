import { z } from 'zod';

/**
 * Validated environment access.
 *
 * Supabase keys here use the NEW key format (`sb_publishable_` / `sb_secret_`),
 * not legacy anon/service_role JWTs — see docs/wiki/DECISIONS.md (DEC-003).
 * The variable NAMES are legacy-styled on purpose; only the values are new.
 *
 * EVERYTHING HERE IS LAZY. An earlier version parsed the public schema at module
 * load, which meant `next build` crashed with "Failed to collect page data"
 * whenever the variables were absent — as they are on a fresh deploy, before
 * anyone has had a chance to set them. A build must not require runtime config;
 * a missing variable should surface at request time with a message that names
 * it, not as a stack trace inside the bundler (ISSUES.md ISSUE-014).
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/**
 * Safe on the client.
 *
 * The `process.env.NEXT_PUBLIC_*` references are written out in full on
 * purpose: Next replaces those exact literals at build time, so destructuring
 * or computing the names would break client-side inlining.
 */
export function publicEnv() {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(
      `Missing or invalid environment variables: ${missing}. Set them in .env.local (local) or your host's variable settings (deployed).`,
    );
  }

  return parsed.data;
}

/** Server-only. Never call this from a Client Component — it reads the secret key. */
export function getServerEnv() {
  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Set it in .env.local (local) or your host's variable settings (deployed).",
    );
  }

  return parsed.data;
}
