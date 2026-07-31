import { createAdminClient } from '@/lib/db/admin';
import { registeredProviderNames } from '@/lib/providers/registry';
import { requireAdmin } from '@/lib/security/auth';

import { ProviderCards, type ProviderCard } from './providers-client';

export default async function ProvidersPage() {
  await requireAdmin();

  const db = createAdminClient();
  const { data } = await db
    .from('providers')
    .select('id, name, key_last4, enabled, encrypted_api_key')
    .order('name');

  const registered = new Set(registeredProviderNames());

  // NOTE: `encrypted_api_key` is selected only to derive a boolean. The
  // ciphertext itself must not cross into the client component — hence the map
  // rather than passing rows through.
  const cards: ProviderCard[] = (data ?? []).map((row) => ({
    name: row.name,
    last4: row.key_last4,
    enabled: row.enabled,
    hasKey: row.encrypted_api_key !== null,
    hasAdapter: registered.has(row.name),
  }));

  const missingRows = [...registered].filter((name) => !cards.some((c) => c.name === name));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Providers</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Keys are encrypted with AES-256-GCM before they touch the database and are decrypted only
          server-side, at call time.
        </p>
      </header>

      <ProviderCards providers={cards} />

      {missingRows.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Adapters with no database row: {missingRows.join(', ')}. Run <code>npm run seed</code>.
        </p>
      ) : null}
    </div>
  );
}
