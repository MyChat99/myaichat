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
  const user = await requireUser();

  const models = await listAvailableModels();
  const { presetTheme } = await loadAppearance();
  const riso = presetTheme === 'riso';

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
      }))}
      selectedModelId={models[0]?.id ?? null}
      conversations={await listConversationTitles()}
      storageEnabled={isStorageConfigured()}
      maxUploadMb={await maxUploadMb()}
      riso={riso}
      isAdmin={user.role === 'admin'}
      /* Only Riso prints a colophon, so only Riso pays for the queries. */
      colophon={riso ? await loadColophon(presses) : undefined}
      /* Formatted on the server: `new Date()` in a client component renders one
         string on the server and another in the browser. */
      lede={
        riso
          ? `${new Date()
              .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
              .replace(
                /(\d+) /,
                '$1 ',
              )} · ${models.length} press${models.length === 1 ? '' : 'es'} running`
          : undefined
      }
    />
  );
}
