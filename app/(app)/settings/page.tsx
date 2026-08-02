import type { Metadata } from 'next';

import { AppearancePanel } from '@/components/theme/appearance-panel';
import { requireUser } from '@/lib/security/auth';
import { loadAppearance } from '@/lib/theme/preferences';

export const metadata: Metadata = { title: 'Appearance' };

/**
 * User-facing appearance settings.
 *
 * Distinct from `/admin/settings`, which is system-wide and admin-only. This
 * one is per-user and available to everyone.
 */
export default async function AppearanceSettingsPage() {
  await requireUser();
  const appearance = await loadAppearance();

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Appearance</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Changes apply as you make them, on every device.
          </p>
        </header>

        <AppearancePanel initial={appearance} />
      </div>
    </div>
  );
}
