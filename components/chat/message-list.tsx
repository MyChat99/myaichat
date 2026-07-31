'use client';

import { Check, Copy, Pencil, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

import { Markdown } from '@/components/chat/markdown';
import { Button } from '@/components/ui/button';

export type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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
      <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap">
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

export function MessageList({ messages, streaming, onRegenerate, onEdit }: Props) {
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      {messages.map((message) => {
        if (message.role === 'user') {
          return (
            <UserMessage key={message.id} message={message} disabled={streaming} onEdit={onEdit} />
          );
        }

        const isStreamingThis = streaming && message.id === 'streaming';

        return (
          <div key={message.id} className="group flex flex-col gap-1">
            <Markdown content={message.content} />

            {isStreamingThis ? (
              <span
                aria-label="Generating response"
                className="bg-foreground/60 inline-block h-4 w-1.5 animate-pulse rounded-sm align-middle"
              />
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
