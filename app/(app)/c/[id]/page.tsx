import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ChatThread } from '@/components/chat/chat-thread';
import type { UiMessage } from '@/components/chat/message-list';
import { createClient } from '@/lib/db/server';
import { listAvailableModels } from '@/lib/providers/registry';
import { requireUser } from '@/lib/security/auth';
import { listConversationTitles } from '@/lib/db/conversations';

export const metadata: Metadata = { title: 'Chat' };

/**
 * A conversation thread. History is read server-side through the user's own
 * client, so RLS decides whether this conversation exists for this user — an
 * id belonging to someone else returns no row and 404s, rather than leaking
 * that it exists at all.
 */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
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
    .order('created_at', { ascending: true });

  const initialMessages: UiMessage[] = (messages ?? [])
    .filter(
      (m): m is { id: string; role: 'user' | 'assistant'; content: string } => m.role !== 'system',
    )
    .map((m) => ({ id: m.id, role: m.role, content: m.content }));

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
    />
  );
}
