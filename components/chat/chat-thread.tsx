'use client';

import { ArrowDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { createConversationForMessage } from '@/app/(app)/conversations/actions';
import { Composer } from '@/components/chat/composer';
import { MessageList, type UiMessage } from '@/components/chat/message-list';
import { Button } from '@/components/ui/button';

type Props = {
  /** Null on the root page — the conversation is created on first send. */
  conversationId: string | null;
  initialMessages: UiMessage[];
};

const STARTERS = [
  'Explain closures in JavaScript with an example',
  'Write a SQL query to find duplicate rows',
  'Summarise the tradeoffs of optimistic UI updates',
  'Help me debug a failing test',
];

/** Distance from the bottom, in px, still treated as "pinned to bottom". */
const STICK_THRESHOLD_PX = 120;

export function ChatThread({ conversationId, initialMessages }: Props) {
  const router = useRouter();

  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  // Survives the first send on the root page, where the thread starts id-less.
  const [activeId, setActiveId] = useState<string | null>(conversationId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Read inside the stream loop, so it must not be stale between renders.
  const stickRef = useRef(true);

  // No prop-to-state sync effect here on purpose: the conversation page keys
  // this component by id, so switching threads remounts with fresh state.

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = distance < STICK_THRESHOLD_PX;
    stickRef.current = bottom;
    setAtBottom(bottom);
  }

  useEffect(() => {
    scrollToBottom('auto');
  }, [conversationId, scrollToBottom]);

  /**
   * Runs one streamed exchange.
   *
   * `message` is omitted when regenerating — the server replays history from
   * the DB. `truncateFrom` drops that message and everything after it, which is
   * how both regenerate and edit-and-resubmit rewind the thread.
   */
  const run = useCallback(
    async (opts: { message?: string; truncateFrom?: string; optimistic?: UiMessage[] }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      stickRef.current = true;
      setAtBottom(true);

      if (opts.optimistic) setMessages(opts.optimistic);
      setMessages((prev) => [...prev, { id: 'streaming', role: 'assistant', content: '' }]);

      try {
        // Create the conversation lazily on first send, then swap the URL
        // without a navigation — a router.push here would remount mid-stream.
        let id = activeId;
        if (!id) {
          id = await createConversationForMessage();
          setActiveId(id);
          window.history.replaceState(null, '', `/c/${id}`);
        }

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            conversationId: id,
            message: opts.message,
            truncateFromMessageId: opts.truncateFrom,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error ?? 'Request failed.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // NDJSON: split on newlines, keep the trailing partial line in `buffer`.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as
              | { type: 'text'; text: string }
              | { type: 'done'; messageId: string | null }
              | { type: 'error'; message: string; retryable: boolean };

            if (event.type === 'text') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === 'streaming' ? { ...m, content: m.content + event.text } : m,
                ),
              );
              if (stickRef.current) scrollToBottom('auto');
            } else if (event.type === 'error') {
              toast.error(event.message);
            } else if (event.type === 'done' && event.messageId) {
              setMessages((prev) =>
                prev.map((m) => (m.id === 'streaming' ? { ...m, id: event.messageId! } : m)),
              );
            }
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          toast.error(err instanceof Error ? err.message : 'Something went wrong.');
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        // Drop an empty placeholder (immediate stop, or a failure before any token).
        setMessages((prev) => prev.filter((m) => !(m.id === 'streaming' && !m.content)));
        router.refresh();
      }
    },
    [activeId, router, scrollToBottom],
  );

  function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || streaming) return;
    setInput('');
    void run({
      message: content,
      optimistic: [...messages, { id: `local-${Date.now()}`, role: 'user', content }],
    });
  }

  function stop() {
    abortRef.current?.abort();
  }

  function regenerate() {
    if (streaming) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    void run({
      truncateFrom: lastAssistant.id,
      optimistic: messages.filter((m) => m.id !== lastAssistant.id),
    });
  }

  function editAndResubmit(messageId: string, newContent: string) {
    if (streaming) return;
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    void run({
      message: newContent,
      truncateFrom: messageId,
      optimistic: [
        ...messages.slice(0, index),
        { id: `local-${Date.now()}`, role: 'user', content: newContent },
      ],
    });
  }

  const empty = messages.length === 0;

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-6 px-4">
            <div className="text-center">
              <h1 className="text-2xl font-semibold">How can I help?</h1>
              <p className="text-muted-foreground mt-1 text-sm">Pick a prompt or write your own.</p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              {STARTERS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  className="border-border hover:bg-accent rounded-lg border p-3 text-left text-sm transition"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <MessageList
            messages={messages}
            streaming={streaming}
            onRegenerate={regenerate}
            onEdit={editAndResubmit}
          />
        )}
      </div>

      {!atBottom && !empty ? (
        <Button
          type="button"
          onClick={() => scrollToBottom()}
          size="sm"
          variant="outline"
          className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full shadow-md"
        >
          <ArrowDown className="mr-1 size-3.5" />
          Scroll to bottom
        </Button>
      ) : null}

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={() => send()}
        onStop={stop}
        streaming={streaming}
      />
    </div>
  );
}
