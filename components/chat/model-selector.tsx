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
};

type Props = {
  models: SelectableModel[];
  selectedId: string | null;
  /** Null on the root page — there is no conversation to pin a model to yet. */
  conversationId: string | null;
  onSelect?: (modelId: string) => void;
};

export function ModelSelector({ models, selectedId, conversationId, onSelect }: Props) {
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

  return (
    <div ref={ref} className="relative">
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
        <span className="max-w-[10rem] truncate text-xs">
          {selected?.displayName ?? 'Select model'}
        </span>
        <ChevronDown className="size-3.5 opacity-60" />
      </Button>

      {open ? (
        <div
          role="listbox"
          className="bg-popover text-popover-foreground absolute right-0 z-50 mt-1 w-64 rounded-lg border p-1 shadow-lg"
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
