'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { AvatarMark } from '@/components/ui/avatar-mark';
import { PressMark } from '@/components/ui/press-mark';
import { avatarSource } from '@/lib/upload/urls';

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
 * ## There is no longer an inert case
 *
 * This used to render nothing interactive when there was no avatar, because a
 * placeholder person-glyph at 4× is not a feature. Preset marks changed that:
 * "no stored value" now means "the mark seeded from your id", which is a real
 * portrait and enlarges like one. Both kinds go through `avatarSource()`, so
 * the trigger, the focus handling and the dismissal are identical either way.
 */
export function AvatarExpand({
  avatarKey,
  label,
  seed,
  size = 22,
}: {
  avatarKey: string | null;
  label: string;
  /** The user id, so an unchosen portrait is still distinct per person. */
  seed?: string;
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

  /*
   * Every reader has a portrait now — an uploaded photo or a generated mark —
   * so there is no longer an inert case. This used to return early when
   * `avatarKey` was null, which was right when "null" meant a placeholder glyph
   * and wrong the moment null started meaning "the mark seeded from your id".
   * A mark IS the portrait, and it enlarges like one.
   */
  const source = avatarSource(avatarKey, seed ?? label);

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
        <AvatarMark avatarKey={avatarKey} label={label} seed={seed} size={size} />
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
            {source.kind === 'upload' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={source.url} alt={`Portrait of ${label}`} draggable={false} />
            ) : (
              /* Drawn at the plate size rather than scaled up from 22px: it is
                 vector, so the 2px rules stay 2px instead of becoming 30. */
              <span data-press="portrait-large-mark">
                <PressMark index={source.index} size={320} title={`Portrait of ${label}`} />
              </span>
            )}
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
