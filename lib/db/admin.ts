import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env';
import { getServerEnv } from '@/lib/env';
import type { Database } from '@/lib/db/types';

/**
 * Privileged Supabase client using the SECRET key (`sb_secret_...`).
 *
 * This client maps to the `service_role` Postgres role and BYPASSES RLS
 * entirely. Rules:
 *   - Never import from a Client Component. The `server-only` import above
 *     turns any such attempt into a build error.
 *   - Never return its raw results to the client without filtering.
 *   - Use it only where a request has already been authorised (admin routes,
 *     auth triggers, seed/migration scripts).
 *
 * See docs/wiki/DECISIONS.md (DEC-003) for the key-format rules.
 */
export function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
