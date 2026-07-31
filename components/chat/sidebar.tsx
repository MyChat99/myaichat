'use client';

import { Menu, MessageSquarePlus, Pin, PinOff, Search, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import {
  createConversation,
  deleteConversation,
  renameConversation,
  togglePin,
} from '@/app/(app)/conversations/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type SidebarConversation = {
  id: string;
  title: string;
  pinned: boolean;
  updated_at: string;
};

export function Sidebar({ conversations }: { conversations: SidebarConversation[] }) {
  const params = useParams<{ id?: string }>();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q))
      : conversations;
    // Pinned first, then most recently updated.
    return [...matched].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updated_at.localeCompare(a.updated_at);
    });
  }, [conversations, query]);

  return (
    <>
      {/* Mobile toggle */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open conversations"
        className="absolute top-3 left-3 z-30 md:hidden"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </Button>

      {open ? (
        <div
          className="bg-background/70 fixed inset-0 z-30 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={`border-border bg-background fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r transition-transform md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 p-3">
          <form action={createConversation} className="flex-1">
            <Button type="submit" className="w-full justify-start" variant="outline" size="sm">
              <MessageSquarePlus className="mr-2 size-4" />
              New chat
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close conversations"
            className="md:hidden"
            onClick={() => setOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="relative px-3 pb-2">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-6 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="h-8 pl-8 text-sm"
          />
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-xs">
              {query ? 'No matching chats.' : 'No chats yet.'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((c) => {
                const active = params?.id === c.id;
                return (
                  <li key={c.id} className="group relative">
                    {editingId === c.id ? (
                      <form
                        action={() => {
                          startTransition(async () => {
                            await renameConversation(c.id, draft);
                            setEditingId(null);
                          });
                        }}
                        className="p-1"
                      >
                        <Input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => setEditingId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          aria-label="Conversation title"
                          className="h-8 text-sm"
                        />
                      </form>
                    ) : (
                      <>
                        <Link
                          href={`/c/${c.id}`}
                          onClick={() => setOpen(false)}
                          onDoubleClick={() => {
                            setDraft(c.title);
                            setEditingId(c.id);
                          }}
                          className={`block truncate rounded-md py-2 pr-16 pl-2 text-sm transition ${
                            active ? 'bg-accent font-medium' : 'hover:bg-accent/60'
                          }`}
                          title={c.title}
                        >
                          {c.pinned ? <Pin className="mr-1 inline size-3" /> : null}
                          {c.title}
                        </Link>

                        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={c.pinned ? 'Unpin conversation' : 'Pin conversation'}
                            onClick={() => startTransition(() => void togglePin(c.id, !c.pinned))}
                          >
                            {c.pinned ? (
                              <PinOff className="size-3.5" />
                            ) : (
                              <Pin className="size-3.5" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label="Delete conversation"
                            onClick={() => {
                              if (confirm(`Delete "${c.title}"? This cannot be undone.`)) {
                                startTransition(() => void deleteConversation(c.id));
                              }
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>
    </>
  );
}
