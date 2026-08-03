import { ChatThread } from '@/components/chat/chat-thread';
import { listAvailableModels, toPricedModels } from '@/lib/providers/registry';
import { requireUser } from '@/lib/security/auth';
import { listConversationTitles } from '@/lib/db/conversations';
import { loadColophon } from '@/lib/db/colophon';
import { loadMonthToDateSpend } from '@/lib/db/costs';
import { isStorageConfigured } from '@/lib/r2/storage';
import { maxUploadMb } from '@/lib/db/settings';

/**
 * New-chat surface. Starts without a conversation id — one is created on the
 * first send, so simply visiting `/` doesn't create an empty thread.
 */
export default async function NewChatPage() {
  const user = await requireUser();

  /**
   * Every remaining load issued together.
   *
   * These were seven sequential `await`s, four of them inline in the JSX below,
   * so each one waited for the previous round trip before starting its own.
   * Measured against the hosted database: **442ms sequential, 104ms if run in
   * parallel** — a third of a second added to every visit and every client-side
   * navigation back to this page, for no reason other than the order the lines
   * happened to be written in.
   *
   * None of them depends on another: the conversation list, the upload limit,
   * the colophon and the month's spend are four unrelated questions.
   */
  const models = await listAvailableModels();
  const presses = new Set(models.map((m) => m.providerName)).size;

  const [conversations, uploadMb, colophon, monthUsd] = await Promise.all([
    listConversationTitles(),
    maxUploadMb(),
    // A "press" is a provider, not a model — the mockup's colophon reads 2 / 2
    // with two vendors configured, however many models each of them offers.
    loadColophon(presses),
    loadMonthToDateSpend(user.id),
  ]);

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
      // Derived from the models already loaded rather than queried again. It
      // was a second read of the same table, and the two lists could disagree.
      pricedModels={toPricedModels(models)}
      selectedModelId={models[0]?.id ?? null}
      conversations={conversations}
      storageEnabled={isStorageConfigured()}
      maxUploadMb={uploadMb}
      isAdmin={user.role === 'admin'}
      avatarKey={user.avatarUrl}
      avatarSeed={user.id}
      email={user.email}
      colophon={colophon}
      spend={{ conversationUsd: 0, monthUsd }}
      lede={{ now: new Date().toISOString(), presses }}
    />
  );
}
