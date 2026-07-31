'use client';

import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { AttachButton, AttachmentTray, DropOverlay } from '@/components/chat/attachments';
import { Button } from '@/components/ui/button';
import type { PendingAttachment } from '@/lib/upload/client';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  /** Attachments live in ChatThread, because send() has to clear them. */
  attachments?: PendingAttachment[];
  onAddFiles?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  dragging?: boolean;
  dropHandlers?: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  storageEnabled?: boolean;
  /** Blocks send while a file is still going up. */
  uploading?: boolean;
};

const MAX_HEIGHT_PX = 200;

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  disabled,
  attachments = [],
  onAddFiles,
  onRemoveAttachment,
  dragging = false,
  dropHandlers,
  storageEnabled = false,
  uploading = false,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: reset to auto first so the box can shrink when text is deleted.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline. Ignore IME composition so
    // committing a candidate doesn't fire the message.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!streaming && !uploading && canSend) onSubmit();
    }
  }

  /**
   * Paste-to-attach. Screenshots arrive on the clipboard far more often than
   * they arrive via a file picker, and a paste that silently does nothing is
   * the single most common complaint about chat composers.
   */
  function handlePaste(event: React.ClipboardEvent) {
    if (!storageEnabled || !onAddFiles) return;
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    onAddFiles(files);
  }

  // A message with only an attachment and no text is legitimate — "what is
  // this?" is implied by the picture.
  const ready = attachments.filter((a) => a.key && !a.error);
  const canSend = Boolean(value.trim()) || ready.length > 0;

  return (
    <div className="border-border bg-background border-t p-4">
      <div className="relative mx-auto max-w-3xl" {...dropHandlers}>
        <DropOverlay active={dragging} />

        {onRemoveAttachment ? (
          <AttachmentTray items={attachments} onRemove={onRemoveAttachment} />
        ) : null}

        <div className="flex items-end gap-2">
          {onAddFiles ? (
            <AttachButton
              onFiles={onAddFiles}
              disabled={disabled || streaming}
              storageEnabled={storageEnabled}
            />
          ) : null}

          <textarea
            ref={ref}
            rows={1}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Send a message…"
            aria-label="Message"
            className="border-input bg-background focus-visible:ring-ring max-h-[200px] flex-1 resize-none rounded-lg border px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          />

          {streaming ? (
            <Button
              type="button"
              onClick={onStop}
              variant="outline"
              size="icon"
              aria-label="Stop generating"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onSubmit}
              disabled={disabled || uploading || !canSend}
              size="icon"
              aria-label={
                uploading ? 'Waiting for attachments to finish uploading' : 'Send message'
              }
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <p className="text-muted-foreground mx-auto mt-2 max-w-3xl text-center text-xs">
        {uploading
          ? 'Waiting for attachments to finish uploading…'
          : 'Enter to send · Shift+Enter for a new line'}
      </p>
    </div>
  );
}
