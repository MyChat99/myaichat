'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
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
  }, [open]);

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
        type="button"
        data-press="slip-action"
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current ? `Filed in ${current.name}. Move` : 'File in an edition'}
        onClick={() => setOpen((v) => !v)}
      >
        ¶
      </button>

      {open ? (
        <div role="listbox" data-press="edition-menu">
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
        </div>
      ) : null}
    </div>
  );
}
