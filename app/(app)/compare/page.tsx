import type { Metadata } from 'next';

import { CompareClient } from '@/components/compare/compare-client';
import { listAvailableModels } from '@/lib/providers/registry';
import { requireUser } from '@/lib/security/auth';

export const metadata: Metadata = { title: 'Ask the presses' };

/**
 * Ask the presses — one prompt, several models, side by side.
 *
 * Only models the app would actually offer reach the picker, so a provider
 * without a key cannot be selected here any more than it can in a conversation.
 */
export default async function ComparePage() {
  await requireUser();

  const models = await listAvailableModels();

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-press="compare-page">
      <CompareClient
        models={models.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          providerName: m.providerName,
        }))}
      />
    </div>
  );
}
