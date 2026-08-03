'use client';

import { Check, Copy, Pencil, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

import { Markdown } from '@/components/chat/markdown';
import { MessageEntrance, useHydrated } from '@/components/motion/motion';
import { formatUsd } from '@/lib/theme/money';
import { Button } from '@/components/ui/button';

export type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /**
   * What this answer cost, read from the usage row that paid for it.
   *
   * Undefined rather than zero when unknown — answers generated before usage
   * rows were linked to messages genuinely have no price, and showing $0.00
   * would be a lie in the one place the number has to be trustworthy.
   */
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
};

type Props = {
  messages: UiMessage[];
  streaming: boolean;
  onRegenerate: () => void;
  onEdit: (messageId: string, content: string) => void;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={copied ? 'Copied' : 'Copy message'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable — not worth interrupting the user over.
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function UserMessage({
  message,
  disabled,
  onEdit,
}: {
  message: UiMessage;
  disabled: boolean;
  onEdit: (id: string, content: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          aria-label="Edit message"
          className="border-input bg-background w-full max-w-[80%] resize-none rounded-lg border p-2 text-sm"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(message.content);
              setEditing(false);
            }}
          >
            <X className="mr-1 size-3.5" />
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!draft.trim() || draft === message.content}
            onClick={() => {
              setEditing(false);
              onEdit(message.id, draft.trim());
            }}
          >
            Save &amp; resubmit
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-end gap-1">
      {/* data-message drives the Document/Bubbles style from CSS, so the
          choice is applied on first paint rather than after hydration. */}
      <div
        data-message="user"
        className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap"
      >
        {message.content}
      </div>
      <div className="flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <CopyButton text={message.content} />
        {/* Local ids belong to messages the server has not acknowledged yet. */}
        {!disabled && !message.id.startsWith('local-') ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Edit and resubmit"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * How many messages are mounted before the "show earlier" control appears.
 *
 * This is windowing, not virtualisation. A real virtualiser (react-window and
 * friends) positions rows absolutely from measured heights — which fights two
 * things this list does: markdown rows whose height is unknown until rendered,
 * and a last row that grows on every token during streaming. The failure mode
 * is a jumping scroll position mid-response, which is far worse than the
 * problem being solved.
 *
 * Capping the mounted count gets the same win (bounded DOM nodes, bounded
 * markdown parsing) with none of that risk, and the older messages are one
 * click away rather than gone.
 */
const WINDOW_SIZE = 60;

/** Rows this far from the bottom get `content-visibility: auto`. */
const ACTIVE_TAIL = 6;

export function MessageList({ messages, streaming, onRegenerate, onEdit }: Props) {
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const [expanded, setExpanded] = useState(false);
  // Messages in the server-rendered HTML must not animate in — see
  // MessageEntrance. Only those mounted after this flips do.
  const hydrated = useHydrated();

  const hiddenCount = expanded ? 0 : Math.max(0, messages.length - WINDOW_SIZE);
  const visible = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      {hiddenCount > 0 ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(true)}>
            Show {hiddenCount} earlier message{hiddenCount === 1 ? '' : 's'}
          </Button>
        </div>
      ) : null}

      {visible.map((message, index) => {
        /**
         * Lets the browser skip layout and paint for rows scrolled well out of
         * view. `contain-intrinsic-size: auto` makes it remember each row's
         * last real height, so the scrollbar does not jump around. The last few
         * rows are excluded — one of them is being written to.
         */
        const offscreenStyle =
          index < visible.length - ACTIVE_TAIL
            ? ({ contentVisibility: 'auto', containIntrinsicSize: 'auto 96px' } as const)
            : undefined;

        if (message.role === 'user') {
          return (
            <MessageEntrance key={message.id} style={offscreenStyle} entering={hydrated}>
              <UserMessage message={message} disabled={streaming} onEdit={onEdit} />
            </MessageEntrance>
          );
        }

        const isStreamingThis = streaming && message.id === 'streaming';

        return (
          <div
            key={message.id}
            style={offscreenStyle}
            className="group flex flex-col gap-1"
            data-message="assistant"
          >
            <Markdown content={message.content} />

            {/* What this answer cost. Rendered only when it is known — an
                answer from before usage rows were linked to messages has no
                price, and $0.00 would be a lie in the one place the number has
                to be trustworthy. */}
            {message.cost !== undefined ? (
              <p data-press="answer-cost">
                <span>{formatUsd(message.cost)}</span>
                <span>{message.inputTokens ?? 0} in</span>
                <span>{message.outputTokens ?? 0} out</span>
              </p>
            ) : null}

            {isStreamingThis ? (
              // A square block caret in the type colour, not a rounded pulsing
              // dot: `rounded-sm` was a radius in a design system whose whole
              // premise is that nothing has one, and a soft pulse belongs to a
              // different language. Styling lives in press.css so reduced
              // motion can hold it steady in one place.
              <span aria-label="Generating response" data-press="caret" />
            ) : null}

            {!isStreamingThis ? (
              <div className="flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <CopyButton text={message.content} />
                {!streaming && message.id === lastAssistantId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Regenerate response"
                    onClick={onRegenerate}
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
