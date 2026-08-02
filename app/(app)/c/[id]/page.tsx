import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ChatThread } from '@/components/chat/chat-thread';
import type { UiMessage } from '@/components/chat/message-list';
import { createClient } from '@/lib/db/server';
import { listAvailableModels } from '@/lib/providers/registry';
import { requireUser } from '@/lib/security/auth';
import { listConversationTitles } from '@/lib/db/conversations';
import { loadConversationCost, loadMonthToDateSpend } from '@/lib/db/costs';
import { isStorageConfigured } from '@/lib/r2/storage';
import { maxUploadMb } from '@/lib/db/settings';

export const metadata: Metadata = { title: 'Chat' };

/**
 * A conversation thread. History is read server-side through the user's own
 * client, so RLS decides whether this conversation exists for this user — an
 * id belonging to someone else returns no row and 404s, rather than leaking
 * that it exists at all.
 */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, model_id')
    .eq('id', id)
    .maybeSingle();

  if (!conversation) notFound();

  const models = await listAvailableModels();

  const { data: messages } = await supabase
    .from('messages')
    .select('id, role, content')
    .eq('conversation_id', id)
    // `seq`, not `created_at`: two messages written in one transaction share a
    // timestamp, and a tie would render them in arbitrary order.
    .order('seq', { ascending: true });

  // What this conversation, and each answer in it, actually cost.
  const cost = await loadConversationCost(id, user.id);

  const initialMessages: UiMessage[] = (messages ?? [])
    .filter(
      (m): m is { id: string; role: 'user' | 'assistant'; content: string } => m.role !== 'system',
    )
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      cost: cost.byMessage.get(m.id)?.costUsd,
      inputTokens: cost.byMessage.get(m.id)?.inputTokens,
      outputTokens: cost.byMessage.get(m.id)?.outputTokens,
    }));

  // Keyed by id so navigating between conversations remounts with fresh state
  // rather than needing a prop-to-state sync effect.
  return (
    <ChatThread
      key={id}
      conversationId={id}
      initialMessages={initialMessages}
      models={models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        providerName: m.providerName,
      }))}
      selectedModelId={conversation.model_id}
      conversations={await listConversationTitles()}
      storageEnabled={isStorageConfigured()}
      maxUploadMb={await maxUploadMb()}
      isAdmin={user.role === 'admin'}
      avatarKey={user.avatarUrl}
      email={user.email}
      spend={{ conversationUsd: cost.totalUsd, monthUsd: await loadMonthToDateSpend(user.id) }}
    />
  );
}
