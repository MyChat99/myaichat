'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { createEdition, setConversationEdition } from '@/app/(app)/editions/actions';
import type { SidebarEdition } from '@/components/chat/sidebar';

/**
 * Where a page is filed.
 *
 * A listbox rather than a native `<select>`: the select's dropdown is OS chrome
 * and this design has no rounded corners anywhere else on the page. The
 * open/close behaviour is the same shape as `ModelSelector` — outside click and
 * Escape both close — because that one is already proven and a second dropdown
 * with its own idea of dismissal is a second thing to get wrong.
 *
 * Creating an edition lives here too. Filing a page is the moment someone
 * discovers they want a new place to put it, and sending them elsewhere to make
 * one first loses the page they were filing.
 */
export function EditionPicker({
  conversationId,
  editionId,
  editions,
}: {
  conversationId: string;
  editionId: string | null | undefined;
  editions: SidebarEdition[];
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Rendered into <body> at fixed coordinates, not inside the row.
   *
   * The sidebar's list is `overflow-y: auto`, and an absolutely-positioned menu
   * inside a scroll container is CLIPPED by it — the further down the list a
   * page sat, the more of its menu was cut off. No z-index fixes that: overflow
   * clipping happens before stacking is considered.
   *
   * Measured when the menu OPENS rather than in a layout effect. Same result,
   * and it keeps setState out of an effect body — React's compiler lint rejects
   * that as a cascading render, and it is right to: the position is known at
   * click time and nothing needs to re-measure before paint.
   */
  type Spot = { left: number; top?: number; bottom?: number };
  const [spot, setSpot] = useState<Spot | null>(null);

  /*
   * No `mounted` guard is needed before portalling: `spot` is only ever set
   * from a click handler, which cannot run during SSR, so `document.body`
   * exists by the time this renders anything.
   */
  const measure = useCallback((): Spot | null => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return null;
    // Flipped upward when the row is near the bottom edge — which is exactly
    // where the clipping was worst, so it is the common case, not the corner.
    const flip = window.innerHeight - r.bottom < 240;
    return {
      left: Math.max(8, r.right - 170),
      top: flip ? undefined : r.bottom + 4,
      bottom: flip ? window.innerHeight - r.top + 4 : undefined,
    };
  }, []);

  // The list scrolls under a fixed menu, so it follows rather than detaching.
  useEffect(() => {
    if (!open) return;
    const follow = () => setSpot(measure());
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        setNaming(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, measure]);

  function file(id: string | null) {
    setOpen(false);
    startTransition(async () => {
      try {
        await setConversationEdition(conversationId, id);
      } catch {
        toast.error('Could not move that page.');
      }
    });
  }

  function makeAndFile() {
    const name = draft.trim();
    if (!name) return;
    setNaming(false);
    setOpen(false);
    setDraft('');
    startTransition(async () => {
      try {
        const id = await createEdition(name);
        await setConversationEdition(conversationId, id);
      } catch {
        toast.error('Could not create that edition.');
      }
    });
  }

  const current = editions.find((e) => e.id === editionId) ?? null;

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        data-press="slip-action"
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current ? `Filed in ${current.name}. Move` : 'File in an edition'}
        onClick={() => {
          if (open) {
            setOpen(false);
            setSpot(null);
            return;
          }
          setSpot(measure());
          setOpen(true);
        }}
      >
        ¶
      </button>

      {open && spot
        ? createPortal(
            <div
              role="listbox"
              data-press="edition-menu"
              style={{ top: spot.top, bottom: spot.bottom, left: spot.left }}
            >
              <p data-press="edition-menu-label">File this page</p>

              <button
                type="button"
                role="option"
                aria-selected={!editionId}
                data-on={!editionId ? 'true' : undefined}
                onClick={() => file(null)}
              >
                Loose pages
              </button>

              {editions.map((edition) => (
                <button
                  key={edition.id}
                  type="button"
                  role="option"
                  aria-selected={edition.id === editionId}
                  data-on={edition.id === editionId ? 'true' : undefined}
                  onClick={() => file(edition.id)}
                >
                  {edition.name}
                </button>
              ))}

              {naming ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    makeAndFile();
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    maxLength={80}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Edition name"
                    aria-label="New edition name"
                    data-press="edition-new-input"
                  />
                </form>
              ) : (
                <button type="button" data-press="edition-new" onClick={() => setNaming(true)}>
                  New edition…
                </button>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
