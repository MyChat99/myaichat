import { ChatThread } from '@/components/chat/chat-thread';
import { listAvailableModels } from '@/lib/providers/registry';
import { requireUser } from '@/lib/security/auth';
import { listConversationTitles } from '@/lib/db/conversations';
import { loadColophon } from '@/lib/db/colophon';
import { loadMonthToDateSpend, loadPricedModels } from '@/lib/db/costs';
import { isStorageConfigured } from '@/lib/r2/storage';
import { maxUploadMb } from '@/lib/db/settings';

/**
 * New-chat surface. Starts without a conversation id — one is created on the
 * first send, so simply visiting `/` doesn't create an empty thread.
 */
export default async function NewChatPage() {
  const user = await requireUser();

  const models = await listAvailableModels();

  // A "press" is a provider, not a model — the mockup's colophon reads 2 / 2
  // with two vendors configured, however many models each of them offers.
  const presses = new Set(models.map((m) => m.providerName)).size;

  return (
    <ChatThread
      conversationId={null}
      initialMessages={[]}
      models={models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        providerName: m.providerName,
        supportsVision: m.supportsVision,
        supportsDocuments: m.supportsDocuments,
      }))}
      pricedModels={await loadPricedModels()}
      selectedModelId={models[0]?.id ?? null}
      conversations={await listConversationTitles()}
      storageEnabled={isStorageConfigured()}
      maxUploadMb={await maxUploadMb()}
      isAdmin={user.role === 'admin'}
      avatarKey={user.avatarUrl}
      email={user.email}
      colophon={await loadColophon(presses)}
      spend={{ conversationUsd: 0, monthUsd: await loadMonthToDateSpend(user.id) }}
      lede={{ now: new Date().toISOString(), presses }}
    />
  );
}
