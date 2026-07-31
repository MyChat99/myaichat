/**
 * Moves provider API keys from .env.local into the encrypted database column.
 *
 * One-time migration for Phase 4. After this runs, chat reads keys from
 * `providers.encrypted_api_key`; the env vars remain only as a local-dev
 * fallback for a fresh checkout.
 *
 *   npm run keys:encrypt
 *
 * Idempotent — re-running re-encrypts from the same env values (a new IV each
 * time, which is expected and harmless).
 */
import { createClient } from '@supabase/supabase-js';

import { SECRET_KEY, SUPABASE_URL } from './_env';
import type { Database } from '../lib/db/types';
import { encryptSecret, keyLast4 } from '../lib/security/crypto';

const admin = createClient<Database>(SUPABASE_URL(), SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SOURCES: { provider: string; envVar: string }[] = [
  { provider: 'anthropic', envVar: 'ANTHROPIC_API_KEY' },
  { provider: 'openai', envVar: 'OPENAI_API_KEY' },
];

async function main() {
  let moved = 0;

  for (const { provider, envVar } of SOURCES) {
    const plaintext = process.env[envVar]?.trim();

    if (!plaintext) {
      console.log(`  skip  ${provider} — ${envVar} not set`);
      continue;
    }

    const { error } = await admin
      .from('providers')
      .update({
        encrypted_api_key: encryptSecret(plaintext),
        key_last4: keyLast4(plaintext),
        enabled: true,
      })
      .eq('name', provider);

    if (error) {
      console.error(`  FAIL  ${provider} — ${error.message}`);
      continue;
    }

    // Only ever print the last 4.
    console.log(`  ok    ${provider} — encrypted (••••${keyLast4(plaintext)})`);
    moved++;
  }

  console.log(`\n${moved} key(s) encrypted into the database.`);
}

main().catch((err: unknown) => {
  console.error('\nencrypt-keys failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
