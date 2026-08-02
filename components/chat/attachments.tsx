'use client';

import { FileText, ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { uploadFile, type PendingAttachment } from '@/lib/upload/client';
import {
  ACCEPT_ATTRIBUTE,
  FALLBACK_MAX_UPLOAD_MB,
  MAX_ATTACHMENTS_PER_MESSAGE,
  describeAccepted,
  kindFor,
  rejectionReason,
} from '@/lib/upload/types';

/**
 * Composer attachments — picker, drag-and-drop, previews, remove-before-send.
 *
 * ⚠️ Storage (Cloudflare R2) is NOT configured in this deployment. Everything
 * here is built and wired; the only step that cannot run is the PUT to the
 * bucket. That is deliberate: the presign route validates auth, suspension,
 * rate limit, type and size BEFORE it touches storage, so every rejection path
 * below is exercisable today and `verify:storage` covers them.
 *
 * When credentials land, nothing in this file changes — `storageEnabled` starts
 * arriving as `true` and the same code path completes.
 */

type Props = {
  items: PendingAttachment[];
  onRemove: (id: string) => void;
};

function iconFor(kind: PendingAttachment['kind']) {
  return kind === 'image' ? ImageIcon : FileText;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The chips above the textarea. */
export function AttachmentTray({ items, onRemove }: Props) {
  if (items.length === 0) return null;

  return (
    <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments" data-press="tray">
      {items.map((item) => {
        const Icon = iconFor(item.kind);
        const failed = Boolean(item.error);

        return (
          <li
            key={item.id}
            data-press="chip"
            data-failed={failed ? 'true' : 'false'}
            className={`border-border bg-muted/40 flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-2 text-xs ${
              failed ? 'border-destructive/50 bg-destructive/5' : ''
            }`}
          >
            {item.previewUrl ? (
              // A local object URL, not a remote asset — next/image would add a loader
              // round trip and an optimisation pass to bytes already in memory.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.previewUrl}
                alt=""
                className="size-7 rounded object-cover"
                data-press="chip-thumb"
                aria-hidden
              />
            ) : (
              <span
                className="bg-background text-muted-foreground grid size-7 place-items-center rounded"
                data-press="chip-thumb"
              >
                <Icon className="size-3.5" aria-hidden />
              </span>
            )}

            <span className="flex min-w-0 flex-col">
              <span className="max-w-[13rem] truncate font-medium" title={item.name}>
                {item.name}
              </span>
              <span className={failed ? 'text-destructive' : 'text-muted-foreground'}>
                {item.error ?? (item.key ? humanSize(item.sizeBytes) : 'Uploading…')}
              </span>
            </span>

            {!item.key && !failed ? (
              <Loader2 className="text-muted-foreground size-3.5 animate-spin" aria-hidden />
            ) : null}

            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={`Remove ${item.name}`}
              className="hover:bg-background text-muted-foreground hover:text-foreground grid size-6 place-items-center rounded transition"
            >
              <X className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The paperclip. Disabled, with a reason, when storage is not configured. */
export function AttachButton({
  onFiles,
  disabled,
  storageEnabled,
}: {
  onFiles: (files: FileList | File[]) => void;
  disabled?: boolean;
  storageEnabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  const title = !storageEnabled
    ? 'File uploads are not configured on this deployment'
    : `Attach a file (${describeAccepted()})`;

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          // Reset so picking the same file twice in a row still fires change.
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || !storageEnabled}
        aria-label={title}
        title={title}
        onClick={() => input.current?.click()}
        data-press="clip"
      >
        <Paperclip className="size-4" />
      </Button>
    </>
  );
}

/** Full-composer drop target, shown only while a drag is over it. */
export function DropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="border-primary bg-background/90 absolute inset-0 z-10 grid place-items-center rounded-lg border-2 border-dashed"
      data-press="drop"
    >
      <p className="text-sm font-medium" data-press="drop-label">
        Drop here
      </p>
    </div>
  );
}

/**
 * Owns the attachment list and the upload lifecycle.
 *
 * Uploads run concurrently and update in place, so one slow file does not hold
 * up the rest — and a failure marks only its own chip rather than clearing the
 * tray. A chip that failed is kept on screen deliberately: silently dropping it
 * would look like the file was attached.
 */
export function useAttachments({
  storageEnabled,
  maxUploadMb = FALLBACK_MAX_UPLOAD_MB,
}: {
  storageEnabled: boolean;
  maxUploadMb?: number;
}) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  // Nested dragenter/dragleave fire for every child element, so a boolean flips
  // off the moment the pointer crosses an inner node. Counting fixes it.
  const dragDepth = useRef(0);

  // Object URLs are a real leak if never revoked; this runs on unmount only,
  // and `remove()` revokes the individual one.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Unmount only. The sync effect above runs after every commit, so this reads
  // the last committed list — writing the ref during render instead would trip
  // React's refs rule and is not needed for anything.
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      for (const item of prev) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }, []);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      if (!storageEnabled) {
        toast.error('File uploads are not configured on this deployment.');
        return;
      }

      const files = Array.from(incoming);
      const maxBytes = maxUploadMb * 1024 * 1024;

      setItems((prev) => {
        const room = MAX_ATTACHMENTS_PER_MESSAGE - prev.length;
        if (room <= 0) {
          toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
          return prev;
        }

        if (files.length > room) {
          toast.error(
            `Only ${room} more file${room === 1 ? '' : 's'} can be attached to this message.`,
          );
        }

        const accepted: PendingAttachment[] = [];

        for (const file of files.slice(0, room)) {
          const reason = rejectionReason(file, maxBytes);
          if (reason) {
            // Named, so with several files the user knows which one failed.
            toast.error(`${file.name}: ${reason}`);
            continue;
          }

          const kind = kindFor(file.type) ?? 'document';
          const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          accepted.push({
            id,
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            kind,
            progress: 0,
            previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
          });

          // Fire the upload after state settles. A rejection here marks the
          // chip; it never throws into the render path.
          void uploadFile(file, 'chat').then((result) => {
            setItems((current) =>
              current.map((item) =>
                item.id === id
                  ? result.ok
                    ? { ...item, key: result.key, kind: result.kind, progress: 100 }
                    : { ...item, error: result.error }
                  : item,
              ),
            );

            if (!result.ok && result.unconfigured) {
              toast.error('File uploads are not configured on this deployment.');
            }
          });
        }

        return [...prev, ...accepted];
      });
    },
    [storageEnabled, maxUploadMb],
  );

  /** Drag handlers for whichever element should accept a drop. */
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!storageEnabled) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!storageEnabled) return;
      e.preventDefault();
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!storageEnabled) return;
      e.preventDefault();
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (!storageEnabled) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    },
  };

  /**
   * The shape `/api/chat` expects. Only fully-uploaded files are included —
   * sending a key that does not exist yet would fail server-side ownership
   * checks and look like a bug rather than a race.
   */
  const payload = items
    .filter((item) => item.key && !item.error)
    .map((item) => ({
      key: item.key!,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      kind: item.kind,
    }));

  return {
    items,
    addFiles,
    remove,
    clear,
    dragging,
    dropHandlers,
    payload,
    /** True while any attachment is still uploading — send should wait. */
    uploading: items.some((item) => !item.key && !item.error),
  };
}
