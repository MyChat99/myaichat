'use client';

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
  /**
   * The "which press is set" chip on the action rail.
   *
   * A NODE rather than a string, because the chip is now the model picker
   * itself. Passing the rendered control in keeps this component free of model
   * state and of the server action, and means the composer and the header
   * share one picker rather than two that have to be kept in step.
   */
  modelControl?: React.ReactNode;
  /**
   * Set when the selected model cannot read something already attached. Shown
   * before send, and blocks it — the alternative is uploading a file and being
   * refused afterwards by the server.
   */
  capabilityRefusal?: string | null;
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
  modelControl = null,
  capabilityRefusal = null,
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
  const canSend = (Boolean(value.trim()) || ready.length > 0) && !capabilityRefusal;

  return (
    <div className="border-border bg-background border-t p-4" data-press="coupon-wrap">
      <div className="relative mx-auto max-w-3xl" {...dropHandlers} data-press="coupon">
        {/* The panel's label rail. The mono line on the right says how to send,
            which is why nothing repeats it under the field. */}
        <div data-press="coupon-l">
          <span>Compose</span>
          <span>Enter to set · Shift+Enter for a new line</span>
        </div>
        <DropOverlay active={dragging} />

        {onRemoveAttachment ? (
          <AttachmentTray items={attachments} onRemove={onRemoveAttachment} />
        ) : null}

        {/* Said before send, not after. `role="alert"` because it appears in
            response to changing the model, which is not where the reader is
            looking. */}
        {capabilityRefusal ? (
          <p role="alert" data-press="chip-warning">
            {capabilityRefusal}
          </p>
        ) : null}

        {/* Three zones: label rail, field, action rail. */}
        <div data-press="coupon-f">
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

        <div data-press="coupon-b">
          <span data-press="rail-left">
            {onAddFiles ? (
              <AttachButton
                onFiles={onAddFiles}
                disabled={disabled || streaming}
                storageEnabled={storageEnabled}
              />
            ) : null}
            {modelControl}
          </span>

          {streaming ? (
            <Button
              type="button"
              onClick={onStop}
              variant="outline"
              size="sm"
              aria-label="Stop generating"
              data-press="quill"
            >
              <span data-press="quill-label">Stop</span>
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
              data-press="quill"
            >
              <span data-press="quill-label">Set it ⏎</span>
            </Button>
          )}
        </div>
      </div>

      {/* The COMPOSE rail above the field already says how to send, so the only
          thing left to announce here is an upload still in flight. */}
      {uploading ? (
        <p className="text-muted-foreground mx-auto mt-2 max-w-3xl text-center text-xs">
          Waiting for attachments to finish uploading…
        </p>
      ) : null}
    </div>
  );
}
