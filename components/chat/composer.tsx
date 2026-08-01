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
  /** Selects the printed treatment's copy. Styling stays in CSS. */
  riso?: boolean;
  /** Printed on Riso's bottom rail, where the mockup names the press. */
  modelLabel?: string | null;
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
  riso = false,
  modelLabel = null,
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
    <div className="border-border bg-background border-t p-4" data-riso="coupon-wrap">
      <div className="relative mx-auto max-w-3xl" {...dropHandlers} data-riso="coupon">
        {/* The boxed COMPOSE panel's label rail. Riso-only: every other theme
            already says this once, under the field — rendering both is how the
            page ended up reading "ComposeEnter to send". */}
        {riso ? (
          <div data-riso="coupon-l">
            <span>Compose</span>
            <span>Enter to set · Shift+Enter for a new line</span>
          </div>
        ) : null}
        <DropOverlay active={dragging} />

        {onRemoveAttachment ? (
          <AttachmentTray items={attachments} onRemove={onRemoveAttachment} />
        ) : null}

        {/* Riso sets the panel as three zones — label rail, field, action rail
            — the way the mockup does. Every other theme keeps the single row it
            was designed with, so this branch changes nothing for them. */}
        {riso ? (
          <>
            <div data-riso="coupon-f">
              <textarea
                ref={ref}
                rows={1}
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Write here…"
                aria-label="Message"
                className="max-h-[200px] w-full resize-none text-sm focus-visible:outline-none disabled:opacity-50"
              />
            </div>

            <div data-riso="coupon-b">
              <span data-riso="rail-left">
                {onAddFiles ? (
                  <AttachButton
                    onFiles={onAddFiles}
                    disabled={disabled || streaming}
                    storageEnabled={storageEnabled}
                  />
                ) : null}
                {modelLabel ? (
                  <span data-riso="setting">
                    <span data-riso="square" data-filled="true" />
                    {modelLabel}
                  </span>
                ) : null}
              </span>

              {streaming ? (
                <Button
                  type="button"
                  onClick={onStop}
                  variant="outline"
                  size="sm"
                  aria-label="Stop generating"
                  data-riso="quill"
                >
                  <span data-riso="quill-label">Stop</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={onSubmit}
                  disabled={disabled || uploading || !canSend}
                  size="sm"
                  aria-label={
                    uploading ? 'Waiting for attachments to finish uploading' : 'Send message'
                  }
                  data-riso="quill"
                >
                  <span data-riso="quill-label">Set it ⏎</span>
                </Button>
              )}
            </div>
          </>
        ) : (
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
        )}
      </div>

      {/* Riso says this on the COMPOSE rail above the field instead, so saying
          it here too would be the same sentence twice. */}
      {riso ? null : (
        <p className="text-muted-foreground mx-auto mt-2 max-w-3xl text-center text-xs">
          {uploading
            ? 'Waiting for attachments to finish uploading…'
            : 'Enter to send · Shift+Enter for a new line'}
        </p>
      )}
      {riso && uploading ? (
        <p className="text-muted-foreground mx-auto mt-2 max-w-3xl text-center text-xs">
          Waiting for attachments to finish uploading…
        </p>
      ) : null}
    </div>
  );
}
