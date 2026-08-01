import { ChatThread } from '@/components/chat/chat-thread';
import { listAvailableModels } from '@/lib/providers/registry';
import { requireUser } from '@/lib/security/auth';
import { loadAppearance } from '@/lib/theme/preferences';
import { listConversationTitles } from '@/lib/db/conversations';
import { loadColophon } from '@/lib/db/colophon';
import { isStorageConfigured } from '@/lib/r2/storage';
import { maxUploadMb } from '@/lib/db/settings';

/**
 * New-chat surface. Starts without a conversation id — one is created on the
 * first send, so simply visiting `/` doesn't create an empty thread.
 */
export default async function NewChatPage() {
  await requireUser();

  const models = await listAvailableModels();
  const { presetTheme } = await loadAppearance();
  const riso = presetTheme === 'riso';

  return (
    <ChatThread
      conversationId={null}
      initialMessages={[]}
      models={models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        providerName: m.providerName,
      }))}
      selectedModelId={models[0]?.id ?? null}
      conversations={await listConversationTitles()}
      storageEnabled={isStorageConfigured()}
      maxUploadMb={await maxUploadMb()}
      riso={riso}
      /* Only Riso prints a colophon, so only Riso pays for the queries. */
      colophon={riso ? await loadColophon(models.length) : undefined}
    />
  );
}
