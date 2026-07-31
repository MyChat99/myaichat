import { ChatThread } from '@/components/chat/chat-thread';
import { requireUser } from '@/lib/security/auth';

/**
 * New-chat surface. Starts without a conversation id — one is created on the
 * first send, so simply visiting `/` doesn't create an empty thread.
 */
export default async function NewChatPage() {
  await requireUser();
  return <ChatThread conversationId={null} initialMessages={[]} />;
}
