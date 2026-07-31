import { ChatThread } from '@/components/chat/chat-thread';
import { listAvailableModels } from '@/lib/providers/registry';
import { requireUser } from '@/lib/security/auth';

/**
 * New-chat surface. Starts without a conversation id — one is created on the
 * first send, so simply visiting `/` doesn't create an empty thread.
 */
export default async function NewChatPage() {
  await requireUser();

  const models = await listAvailableModels();

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
    />
  );
}
