'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { setConversationModel } from '@/app/(app)/conversations/actions';
import { ProviderLogo } from '@/components/chat/provider-logo';
import { Button } from '@/components/ui/button';

export type SelectableModel = {
  id: string;
  displayName: string;
  providerName: string;
  /**
   * Carried to the client so the composer can refuse a pairing BEFORE the
   * upload and the send. Without these the paperclip cannot know that the
   * selected model will reject the file it just accepted.
   */
  supportsVision: boolean;
  supportsDocuments: boolean;
};

type Props = {
  models: SelectableModel[];
  selectedId: string | null;
  /** Null on the root page — there is no conversation to pin a model to yet. */
  conversationId: string | null;
  onSelect?: (modelId: string) => void;
  /**
   * How the TRIGGER looks. The menu, the selection behaviour and the server
   * action are identical either way.
   *
   * `ticket` is the header control. `chip` is the composer's setting chip,
   * which read as a label for a long time because it was one — a `<span>` with
   * no handler, no focus and no ARIA. Rendering it through this component
   * rather than giving the composer its own dropdown means there is one menu,
   * one `choose()` and one place a mid-conversation switch can go wrong.
   */
  variant?: 'ticket' | 'chip';
  /**
   * Which way the menu opens. The composer sits at the bottom of the viewport,
   * where a downward menu would open off-screen.
   */
  menuPlacement?: 'below' | 'above';
};

export function ModelSelector({
  models,
  selectedId,
  conversationId,
  onSelect,
  variant = 'ticket',
  menuPlacement = 'below',
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const selected = models.find((m) => m.id === selectedId) ?? models[0] ?? null;

  // Close on outside click / Escape — a menu that traps the pointer is worse
  // than no menu.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (models.length === 0) {
    return <span className="text-muted-foreground text-xs">No models configured</span>;
  }

  function choose(modelId: string) {
    setOpen(false);
    onSelect?.(modelId);

    // On the root page there is nothing to persist to yet; the conversation is
    // created on first send and picks up the choice then.
    if (!conversationId) return;

    startTransition(async () => {
      try {
        await setConversationModel(conversationId, modelId);
      } catch {
        toast.error('Could not switch model.');
      }
    });
  }

  // Group by provider, preserving the order models arrived in.
  const grouped = models.reduce<Record<string, SelectableModel[]>>((acc, model) => {
    (acc[model.providerName] ??= []).push(model);
    return acc;
  }, {});

  const label = selected?.displayName ?? 'Select model';

  return (
    <div ref={ref} className="relative">
      {variant === 'chip' ? (
        /*
         * The composer chip, now a real control.
         *
         * Deliberately still a `data-press="setting"` so it looks exactly as it
         * did — this is the same chip, not a new affordance in its place. What
         * changed is that it is a <button> with the ARIA a listbox trigger
         * needs, so it is reachable by keyboard and announced as expandable.
         */
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Model: ${label}. Change model`}
          data-press="setting"
          data-interactive="true"
        >
          <span data-press="square" data-filled="true" />
          {label}
        </button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="gap-1.5"
          data-press="ticket"
        >
          {selected ? <ProviderLogo provider={selected.providerName} /> : null}
          <span className="max-w-[10rem] truncate text-xs">{label}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      )}

      {open ? (
        <div
          role="listbox"
          className={`bg-popover text-popover-foreground absolute left-0 z-50 w-64 rounded-lg border p-1 shadow-lg sm:right-0 sm:left-auto ${
            menuPlacement === 'above' ? 'bottom-full mb-1' : 'mt-1'
          }`}
        >
          {Object.entries(grouped).map(([provider, providerModels]) => (
            <div key={provider}>
              <p className="text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium uppercase">
                <ProviderLogo provider={provider} />
                {provider}
              </p>
              {providerModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={model.id === selected?.id}
                  onClick={() => choose(model.id)}
                  className="hover:bg-accent flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                >
                  <span className="truncate">{model.displayName}</span>
                  {model.id === selected?.id ? <Check className="size-3.5 shrink-0" /> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
