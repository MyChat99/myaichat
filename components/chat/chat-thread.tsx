'use client';

import { ArrowDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { createConversationForMessage } from '@/app/(app)/conversations/actions';
import { useAttachments } from '@/components/chat/attachments';
import { CommandPalette } from '@/components/command/command-palette';
import { Composer } from '@/components/chat/composer';
import { SectionTabs } from '@/components/chat/section-tabs';
import { LocalTime } from '@/components/ui/local-time';
import { MessageList, type UiMessage } from '@/components/chat/message-list';
import { ModelSelector, type SelectableModel } from '@/components/chat/model-selector';
import { Button } from '@/components/ui/button';

type Props = {
  /** Null on the root page — the conversation is created on first send. */
  conversationId: string | null;
  initialMessages: UiMessage[];
  models: SelectableModel[];
  selectedModelId: string | null;
  /** For the command palette's conversation search. */
  conversations?: { id: string; title: string }[];
  /** False until R2 credentials exist; disables the paperclip with a reason. */
  storageEnabled?: boolean;
  maxUploadMb?: number;
  /** Figures for Riso's opening spread. Absent on every other theme. */
  colophon?: { notes: number; spendUsd: number; presses: number };
  /** The rule bar carries the navigation, so it needs these. */
  isAdmin?: boolean;
  avatarKey?: string | null;
  email?: string | null;
  /** The dateline, as an instant — formatted in the reader's own zone. */
  lede?: { now: string; presses: number };
};

/**
 * The second line is printed only by Riso, whose picks are two-line entries in
 * the mockup. Every other theme shows the prompt alone, exactly as before.
 */
const STARTERS: { prompt: string; note: string }[] = [
  {
    prompt: 'Explain closures in JavaScript with an example',
    note: 'The one about private state, and why the naive counter leaks',
  },
  {
    prompt: 'Write a SQL query to find duplicate rows',
    note: 'Group by what should be unique, keep the groups above one',
  },
  {
    prompt: 'Summarise the tradeoffs of optimistic UI updates',
    note: 'Correctness at a glance against latency at a glance',
  },
  {
    prompt: 'Help me debug a failing test',
    note: 'Bring the output; the message is usually the whole story',
  },
];

/** Distance from the bottom, in px, still treated as "pinned to bottom". */
const STICK_THRESHOLD_PX = 120;

export function ChatThread({
  conversationId,
  initialMessages,
  models,
  selectedModelId,
  conversations = [],
  storageEnabled = false,
  maxUploadMb,
  colophon,
  isAdmin = false,
  avatarKey = null,
  email = null,
  lede,
}: Props) {
  const router = useRouter();

  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  // Survives the first send on the root page, where the thread starts id-less.
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  const [modelId, setModelId] = useState<string | null>(selectedModelId ?? models[0]?.id ?? null);

  const attachments = useAttachments({ storageEnabled, maxUploadMb });

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
    // Only when there is a conversation to be at the bottom OF. On the empty
    // state there is nothing to follow, and scrolling it pushed the top of the
    // page — the opening headline — out of view before the user had done
    // anything at all.
    if (initialMessages.length === 0) return;
    scrollToBottom('auto');
  }, [conversationId, initialMessages.length, scrollToBottom]);

  /**
   * Runs one streamed exchange.
   *
   * `message` is omitted when regenerating — the server replays history from
   * the DB. `truncateFrom` drops that message and everything after it, which is
   * how both regenerate and edit-and-resubmit rewind the thread.
   */
  const run = useCallback(
    async (opts: {
      message?: string;
      truncateFrom?: string;
      optimistic?: UiMessage[];
      attachments?: ReturnType<typeof useAttachments>['payload'];
    }) => {
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
          // Pass the selector's choice so the first send honours it rather than
          // silently falling back to the default model.
          id = await createConversationForMessage(modelId ?? undefined);
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
            attachments: opts.attachments?.length ? opts.attachments : undefined,
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
    [activeId, modelId, router, scrollToBottom],
  );

  function send(text?: string) {
    const content = (text ?? input).trim();
    const files = attachments.payload;

    // An attachment with no words is a valid message; empty-and-attachment-less
    // is not. Uploads still in flight block send rather than being dropped.
    if ((!content && files.length === 0) || streaming || attachments.uploading) return;

    setInput('');
    // Cleared before the request, not after: the files are already in R2 and
    // referenced by key, so leaving the chips up would invite a double-send.
    attachments.clear();

    void run({
      message: content || `Sent ${files.length} file${files.length === 1 ? '' : 's'}`,
      attachments: files,
      optimistic: [
        ...messages,
        {
          id: `local-${Date.now()}`,
          role: 'user',
          content: content || `📎 ${files.map((f) => f.name).join(', ')}`,
        },
      ],
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
      <CommandPalette
        conversations={conversations}
        models={models.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          providerName: m.providerName,
        }))}
        onSelectModel={setModelId}
      />

      <div
        className="border-border flex items-center justify-end gap-1 border-b px-4 py-1.5"
        data-press="rule"
      >
        {/* The mockup's rule bar leads with the folio — the page you are on —
            and sets the model ticket beside it. Without it the band is an
            empty rule with one control pushed to the far edge. */}
        <span data-press="folio">
          {conversations.find((c) => c.id === activeId)?.title ?? 'New page'}
        </span>
        {activeId ? (
          <>
            {/* Plain anchors, not fetch + Blob: the browser already knows how
                to save a response with a content-disposition header, and doing
                it by hand means holding the whole export in memory first. */}
            <a
              href={`/api/conversations/${activeId}/export?format=md`}
              download
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md px-2 py-1 text-xs transition"
              title="Download this conversation as Markdown"
            >
              .md
            </a>
            <a
              href={`/api/conversations/${activeId}/export?format=json`}
              download
              className="text-muted-foreground hover:bg-accent hover:text-foreground mr-1 rounded-md px-2 py-1 text-xs transition"
              title="Download this conversation as JSON"
            >
              .json
            </a>
          </>
        ) : null}

        <ModelSelector
          models={models}
          selectedId={modelId}
          conversationId={activeId}
          onSelect={setModelId}
        />

        {/* Sections live in this bar under Riso, so the page has one top rule
            rather than two stacked bands. See RisoTabs. */}
        <SectionTabs isAdmin={isAdmin} avatarKey={avatarKey} email={email} />
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {empty ? (
          <div
            className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-6 px-4"
            data-press="spread"
          >
            {/* One opening or the other, never both. Riso prints an editorial
                spread; every other theme keeps the plain prompt. */}
            <div className="text-center" data-press="lede">
              {lede ? (
                <div data-press="lede-num">
                  <LocalTime iso={lede.now} style="date" uppercase /> · {lede.presses} press
                  {lede.presses === 1 ? '' : 'es'} running
                </div>
              ) : null}
              <h1 className="text-2xl font-semibold" data-press="headline">
                A quiet place
                <br />
                to <mark>think out loud</mark>.
              </h1>
              <p className="text-muted-foreground mt-1 text-sm" data-press="standfirst">
                {`${models.length} model${models.length === 1 ? ' is' : 's are'} inked and ready. Ask something badly, change your mind halfway through, and start again — nothing here is precious.`}
              </p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2" data-press="picks">
              {STARTERS.map(({ prompt, note }, i) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  className="border-border hover:bg-accent rounded-lg border p-3 text-left text-sm transition"
                  data-press="pick"
                >
                  <span data-press="pick-n" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span data-press="pick-body">
                    <span data-press="pick-t">{prompt}</span>
                    {/* Inline, not stacked: in the mockup the note continues
                        the title on the same line and wraps with it. */}
                    <span data-press="pick-d"> {note}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* The foot of the spread: the reader's own figures, not invented
                ones. Printed only when Riso asked for them. */}
            {colophon ? (
              <div data-press="colophon">
                <div data-press="col-c">
                  <div data-press="col-l">Notes set</div>
                  <div data-press="col-v">{colophon.notes.toLocaleString()}</div>
                </div>
                <div data-press="col-c">
                  <div data-press="col-l">Ink used</div>
                  <div data-press="col-v">
                    $
                    {colophon.spendUsd < 0.01 && colophon.spendUsd > 0
                      ? '<0.01'
                      : colophon.spendUsd.toFixed(2)}
                  </div>
                </div>
                <div data-press="col-c">
                  <div data-press="col-l">Presses</div>
                  <div data-press="col-v">
                    {colophon.presses} / {colophon.presses}
                  </div>
                </div>
              </div>
            ) : null}
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
        attachments={attachments.items}
        onAddFiles={attachments.addFiles}
        onRemoveAttachment={attachments.remove}
        dragging={attachments.dragging}
        dropHandlers={attachments.dropHandlers}
        storageEnabled={storageEnabled}
        uploading={attachments.uploading}
        modelLabel={models.find((m) => m.id === modelId)?.displayName ?? null}
      />
    </div>
  );
}
