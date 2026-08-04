'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A confirmation that belongs to this application.
 *
 * `window.confirm()` is OS chrome: a rounded system panel in the system font,
 * dropped on top of a design whose one structural invariant is `--radius: 0`.
 * It also cannot be styled, cannot carry a destructive emphasis, and on some
 * platforms offers a "prevent this page from creating more dialogs" checkbox
 * that silently disables every later confirmation — including the one guarding
 * a delete.
 *
 * Promise-based so the call sites read the way they did before:
 *
 *   if (await confirm({ … })) doTheThing();
 *
 * Focus is trapped while it is open and returned to whatever opened it, Escape
 * and a click outside both cancel, and the destructive action is the one that
 * looks destructive rather than merely being on the right.
 */

export type ConfirmRequest = {
  title: string;
  /** Newlines are respected, so a two-paragraph explanation stays two. */
  body?: string;
  /** Defaults to "Confirm". */
  confirmLabel?: string;
  /** Marks the confirm button as the dangerous one. */
  destructive?: boolean;
};

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const confirm = useCallback((next: ConfirmRequest) => {
    restoreFocus.current = document.activeElement as HTMLElement;
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    setRequest(null);
    resolver.current?.(ok);
    resolver.current = null;
    // Back to the control that asked, not to the top of the document.
    restoreFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!request) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
        return;
      }
      /*
       * A real focus trap, not just an autofocus. Without it Tab walks out of
       * the dialog and into the page behind — which is still there, still
       * clickable to a screen reader, and offers the very action being asked
       * about.
       */
      if (event.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>('button');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [request, settle]);

  // Focus the dialog itself, so the first Tab lands on Cancel rather than
  // starting the confirm button pre-selected under a stray Enter.
  useEffect(() => {
    if (request) panelRef.current?.focus();
  }, [request]);

  const dialog =
    request &&
    createPortal(
      <div
        data-press="confirm-scrim"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) settle(false);
        }}
      >
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-label={request.title}
          tabIndex={-1}
          data-press="confirm"
        >
          <p data-press="confirm-title">{request.title}</p>
          {request.body ? <p data-press="confirm-body">{request.body}</p> : null}
          <div data-press="confirm-actions">
            <button type="button" data-press="confirm-cancel" onClick={() => settle(false)}>
              Cancel
            </button>
            <button
              type="button"
              data-press="confirm-go"
              data-danger={request.destructive ? 'true' : undefined}
              onClick={() => settle(true)}
            >
              {request.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return { confirm, dialog };
}
