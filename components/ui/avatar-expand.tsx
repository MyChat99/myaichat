'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { AvatarMark } from '@/components/ui/avatar-mark';
import { attachmentUrl } from '@/lib/upload/urls';

/**
 * The reader's portrait, at a size you can actually see.
 *
 * ## Why this is a separate component and not a flag on AvatarMark
 *
 * `AvatarMark` is rendered from a Server Component in the app shell. Marking it
 * `'use client'` would turn every one of its exports into a client reference,
 * which is precisely the failure that took production down: a Server Component
 * calling what it thought was a function and getting a reference instead —
 * invisible to `tsc`, to `next build`, and to `next dev`.
 *
 * So the interactive version wraps it instead. `attachmentUrl` stays in
 * `lib/upload/urls.ts`, which carries no directive and must not acquire one;
 * a CLIENT module importing it is the safe direction, and `verify:boundaries`
 * pins that file so the unsafe direction cannot come back.
 *
 * ## Inert without a portrait, deliberately
 *
 * With no avatar there is nothing to enlarge — the placeholder glyph at 4× is
 * not a feature. It renders the plain mark, with no button, no focus stop and
 * nothing announced, rather than offering an action that does nothing.
 */
export function AvatarExpand({
  avatarKey,
  label,
  size = 22,
}: {
  avatarKey: string | null;
  label: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = useCallback(() => {
    setOpen(false);
    // Focus goes back where it came from. Without this it lands on <body> and
    // the next Tab restarts from the top of the page.
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    }
    /*
     * "Clicking anywhere else returns it to the small form" — including on the
     * enlarged portrait itself, which is the instinctive way to dismiss a thing
     * you opened by clicking. Bound on the document so no part of the page is a
     * dead zone, and on `mousedown` so the dismissal happens on press rather
     * than after a click that may land somewhere else entirely.
     */
    function onPointerDown() {
      close();
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, close]);

  // Move focus INTO the enlarged view when it opens, so a keyboard reader is
  // taken to the thing that just appeared rather than left behind it.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!avatarKey) return <AvatarMark avatarKey={null} label={label} size={size} />;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Portrait of ${label}. Show larger`}
        data-press="portrait-trigger"
        className="inline-flex shrink-0 align-middle"
      >
        <AvatarMark avatarKey={avatarKey} label={label} size={size} />
      </button>

      {open ? (
        <div data-press="portrait-scrim" role="presentation">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            data-press="portrait-large"
            /* The scrim already closes on any mousedown. Stopping propagation
               here would create exactly the dead zone the requirement rules
               out, so the enlarged view deliberately does NOT do that. */
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachmentUrl(avatarKey)} alt={`Portrait of ${label}`} draggable={false} />
            <p id={titleId} data-press="portrait-caption">
              {label}
            </p>
            <p data-press="portrait-hint">Click anywhere or press Esc to close</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
