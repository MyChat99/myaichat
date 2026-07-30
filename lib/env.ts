import { z } from 'zod';

/**
 * Validated environment access.
 *
 * Supabase keys here use the NEW key format (`sb_publishable_` / `sb_secret_`),
 * not legacy anon/service_role JWTs — see docs/wiki/DECISIONS.md (DEC-003).
 * The variable NAMES are legacy-styled on purpose; only the values are new.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/** Safe on the client. Referenced with full literal names so Next can inline them. */
export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

/**
 * Server-only. Never call this from a Client Component — it reads the secret key.
 * Lazy so that merely importing this module from shared code cannot throw.
 */
export function getServerEnv() {
  return serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
