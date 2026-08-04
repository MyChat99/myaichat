'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Keyboard, MessageSquarePlus, Palette, Search, Sparkles, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { overlayVariants, panelVariants, useMotionSafe } from '@/components/motion/motion';

/**
 * Command palette (Cmd/Ctrl+K).
 *
 * Deliberately dependency-free rather than pulling in cmdk: the whole surface
 * is one list with a filter, and a modal that owns focus is something worth
 * controlling directly — the accessibility details below are the actual work,
 * and they are easy to lose behind a library's defaults.
 */

export type PaletteConversation = { id: string; title: string };
export type PaletteModel = { id: string; displayName: string; providerName: string };

type Props = {
  conversations: PaletteConversation[];
  models: PaletteModel[];
  onSelectModel?: (modelId: string) => void;
};

type Item = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
};

export function CommandPalette({ conversations, models, onSelectModel }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Focus is returned here on close, so keyboard users are not dumped at the
  // top of the document.
  const restoreFocus = useRef<HTMLElement | null>(null);
  const animate = useMotionSafe();

  const close = useCallback(() => {
    setOpen(false);
    setShowHelp(false);
    setQuery('');
    setActive(0);
  }, []);

  // Focus restoration lives in an effect rather than in `close()`: reading a
  // ref inside a callback invoked from JSX trips React's refs-during-render
  // rule, and reacting to the closed state is the idiomatic form regardless.
  const wasOpen = useRef(false);
  useEffect(() => {
    const isOpen = open || showHelp;
    if (wasOpen.current && !isOpen) restoreFocus.current?.focus?.();
    wasOpen.current = isOpen;
  }, [open, showHelp]);

  // Global shortcuts.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        restoreFocus.current = document.activeElement as HTMLElement;
        setOpen((v) => !v);
        return;
      }

      // `?` opens shortcuts help — but not while typing, or it becomes
      // impossible to type a question mark anywhere in the app.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

      if (event.key === '?' && !typing && !open) {
        event.preventDefault();
        restoreFocus.current = document.activeElement as HTMLElement;
        setShowHelp(true);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const items: Item[] = useMemo(() => {
    const base: Item[] = [
      {
        id: 'new-chat',
        label: 'New chat',
        hint: 'Start a fresh conversation',
        icon: MessageSquarePlus,
        run: () => router.push('/'),
      },
      {
        id: 'appearance',
        label: 'Appearance settings',
        hint: 'Theme, accent, text size',
        icon: Palette,
        run: () => router.push('/settings'),
      },
      {
        id: 'profile',
        label: 'Profile',
        hint: 'Name and avatar',
        icon: UserRound,
        run: () => router.push('/profile'),
      },
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        hint: '?',
        icon: Keyboard,
        run: () => setShowHelp(true),
      },
    ];

    const modelItems: Item[] = models.map((m) => ({
      id: `model-${m.id}`,
      label: `Switch to ${m.displayName}`,
      hint: m.providerName,
      icon: Sparkles,
      run: () =>
        // Prop when one is given, event otherwise: the shell mounts this with
        // no handler, and the chat thread — the only thing that owns a model —
        // listens for it.
        onSelectModel
          ? onSelectModel(m.id)
          : window.dispatchEvent(new CustomEvent('pilcrow:select-model', { detail: m.id })),
    }));

    const conversationItems: Item[] = conversations.slice(0, 50).map((c) => ({
      id: `chat-${c.id}`,
      label: c.title,
      hint: 'Conversation',
      icon: Search,
      run: () => router.push(`/c/${c.id}`),
    }));

    return [...base, ...modelItems, ...conversationItems];
  }, [conversations, models, onSelectModel, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 12);
    return items.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 20);
  }, [items, query]);

  function onInputKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = filtered[active];
      if (item) {
        close();
        item.run();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  // Keep the highlighted row visible when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
            variants={animate ? overlayVariants : undefined}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={close}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              className="bg-popover text-popover-foreground w-full max-w-lg overflow-hidden rounded-xl border shadow-2xl"
              variants={animate ? panelVariants : undefined}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 border-b px-3">
                <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onInputKeyDown}
                  placeholder="Search commands and conversations…"
                  aria-label="Search commands"
                  aria-controls="palette-list"
                  className="flex-1 bg-transparent py-3 text-sm outline-none"
                />
                <kbd className="text-muted-foreground border-border rounded border px-1.5 py-0.5 text-[10px]">
                  esc
                </kbd>
              </div>

              <div
                ref={listRef}
                id="palette-list"
                role="listbox"
                className="max-h-80 overflow-y-auto p-1"
              >
                {filtered.length === 0 ? (
                  <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                    Nothing matches “{query}”.
                  </p>
                ) : (
                  filtered.map((item, index) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={index === active}
                        data-active={index === active}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => {
                          close();
                          item.run();
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm ${
                          index === active ? 'bg-accent' : ''
                        }`}
                      >
                        <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.hint ? (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {item.hint}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '⌘K / Ctrl+K', action: 'Open the command palette' },
  { keys: '?', action: 'Show this help' },
  { keys: 'Enter', action: 'Send a message' },
  { keys: 'Shift + Enter', action: 'New line in the composer' },
  { keys: '↑ ↓', action: 'Move through palette results' },
  { keys: 'Esc', action: 'Close the palette or cancel an edit' },
];

function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const animate = useMotionSafe();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          variants={animate ? overlayVariants : undefined}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            className="bg-popover text-popover-foreground w-full max-w-sm rounded-xl border p-5 shadow-2xl"
            variants={animate ? panelVariants : undefined}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Keyboard className="size-4" aria-hidden />
              Keyboard shortcuts
            </h2>
            <dl className="space-y-2">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-muted-foreground">{s.action}</dt>
                  <dd>
                    <kbd className="border-border rounded border px-1.5 py-0.5 font-mono text-[11px]">
                      {s.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
