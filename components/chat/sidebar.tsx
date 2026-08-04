'use client';

import { Menu, MessageSquarePlus, Pin, PinOff, Search, Trash2, X } from 'lucide-react';

import { EditionPicker } from '@/components/chat/edition-picker';
import { useConfirm } from '@/components/ui/press-confirm';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useMemo, useState, useTransition } from 'react';

import { dayGroup, issueNumber } from '@/lib/time';
import { useHydrated } from '@/lib/hooks/use-hydrated';

import {
  createConversation,
  deleteConversation,
  renameConversation,
  togglePin,
} from '@/app/(app)/conversations/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type SidebarEdition = { id: string; name: string };

export type SidebarConversation = {
  id: string;
  title: string;
  pinned: boolean;
  updated_at: string;
  /** Null when the page is loose. */
  editionId?: string | null;
  /** Null when the conversation's model has since been removed. */
  modelName?: string | null;
  /**
   * Which press set it, as a slot number rather than a name.
   *
   * The stamp's square is filled for one press and hollow for the next — the
   * mockup's way of telling them apart at a glance. The slot is resolved from
   * the provider registry on the server, so this component never learns a
   * vendor's name; `verify:providers` fails the build if one appears here, and
   * it caught exactly that when this was first written as a comparison against
   * a literal vendor name.
   */
  pressSlot?: number | null;
  messageCount?: number;
  /** Section heading, computed server-side. See `groupFor` in the app layout. */
  group?: string;
};

/**
 * The masthead's issue line, as instants rather than formatted strings.
 *
 * `since` is when the account was created; the issue NUMBER is how many days it
 * has been publishing. That reads like a periodical and is actually true of the
 * reader, where the previous value — a raw count of their conversations — was
 * a number that looked meaningful and was not. Day one is No. 1.
 */
export type SidebarIssue = { since: string; now: string };

export function Sidebar({
  conversations,
  editions = [],
  issue,
}: {
  conversations: SidebarConversation[];
  editions?: SidebarEdition[];
  issue?: SidebarIssue;
}) {
  const params = useParams<{ id?: string }>();
  const [query, setQuery] = useState('');
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [, startTransition] = useTransition();

  /**
   * Section headings are re-bucketed in the reader's own zone once hydrated.
   *
   * The server can only bucket in UTC, which puts an evening conversation in
   * the Americas under tomorrow's heading. Before hydration this uses exactly
   * what the server sent, so the two agree; afterwards it uses the local day
   * boundary and a heading may move.
   */
  const hydrated = useHydrated();

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

  /**
   * Section headings, derived from the already-sorted list.
   *
   * A heading is emitted when the group changes rather than by bucketing into
   * separate arrays, so the sort order stays the single source of truth and a
   * pinned conversation cannot end up under a heading it does not belong to —
   * pinned items sort to the top and simply carry their own heading with them.
   */
  /**
   * Editions first, then loose pages under their date headings.
   *
   * Two lists rather than one, because they answer different questions: an
   * edition is a place the reader PUT something, a date heading is when they
   * last touched it. Filing a page into an edition should not change what day
   * it was written, and the database enforces exactly that — releasing a page
   * leaves `updated_at` alone, so it drops back under its original heading
   * rather than under Today.
   */
  const loose = useMemo(() => filtered.filter((c) => !c.editionId), [filtered]);

  const byEdition = useMemo(() => {
    const groups = new Map<string, SidebarConversation[]>();
    for (const c of filtered) {
      if (c.editionId)
        (groups.get(c.editionId) ?? groups.set(c.editionId, []).get(c.editionId)!).push(c);
    }
    return groups;
  }, [filtered]);

  /**
   * One ordered list: every edition's pages, then the loose ones.
   *
   * Composed rather than rendered as two separate `.map()` blocks, because the
   * conversation card is forty lines of markup with rename, pin and delete in
   * it — duplicating that to draw the same card under two headings is how the
   * two copies drift, and this codebase has already shipped one avatar fixed in
   * one place and dead in the other.
   */
  const editionHeaderAt = useMemo(() => {
    const at = new Map<string, SidebarEdition>();
    for (const edition of editions) {
      const first = byEdition.get(edition.id)?.[0];
      if (first) at.set(first.id, edition);
    }
    return at;
  }, [editions, byEdition]);

  const ordered = useMemo(
    () => [...editions.flatMap((e) => byEdition.get(e.id) ?? []), ...loose],
    [editions, byEdition, loose],
  );

  /**
   * "Loose pages" introduces the unfiled run — but only when an edition exists.
   * With none, every page is loose and the label would be a heading over the
   * whole list saying nothing the reader does not already know.
   */
  const looseHeaderAt = useMemo(
    () =>
      editions.some((e) => (byEdition.get(e.id) ?? []).length > 0) ? (loose[0]?.id ?? null) : null,
    [editions, byEdition, loose],
  );

  const headings = useMemo(() => {
    const now = new Date();
    const at = new Map<string, string>();
    let previous: string | undefined;
    // Derived from the LOOSE list: a date heading introduces loose pages, and
    // emitting them across the whole set would print headings for pages that
    // are filed under an edition and never shown here.
    for (const c of loose) {
      const group = hydrated ? dayGroup(c.updated_at, now, false) : c.group;
      if (group && group !== previous) {
        at.set(c.id, group);
        previous = group;
      }
    }
    return at;
  }, [loose, hydrated]);

  return (
    <>
      {confirmDialog}
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
          data-press="scrim"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        data-press="leaf"
        className={`border-border bg-background fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r transition-transform md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* The masthead. The doubled word is the second ink plate laid over the
            first — it reads as a duplicate only if the stylesheet that
            positions it is missing. */}
        <div data-press="masthead">
          {/* "¶ Pilcrow" is one unit: the mark is the logo, the word is the
              wordmark, and they are set tight so the pair reads as a lockup
              rather than as a bullet in front of a heading. The glyph is
              aria-hidden — it is the same name said twice to a screen reader
              otherwise. */}
          <div data-press="lockup">
            <span data-press="mark" aria-hidden="true">
              ¶
            </span>
            <div data-press="wordmark">
              Pilcrow
              <span aria-hidden="true">Pilcrow</span>
            </div>
          </div>
          {issue ? (
            /**
             * Set beside the wordmark rather than beneath it, so the wordmark
             * centres on the same line as the navigation opposite it.
             *
             * One row is narrower than two. Measured: 79px of room beside the
             * wordmark, against 36px for "No. 4" and 58px for "3 AUGUST" — one
             * of them fits, not both, and "No. 1 · 3 …" truncating mid-date
             * reads as a bug. The issue number stays because it is the
             * masthead's own counter; the date is on every clock the reader
             * owns.
             */
            <div data-press="issue">No. {issueNumber(issue.since, issue.now, !hydrated)}</div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 p-3" data-press="actions">
          <form action={createConversation} className="flex-1">
            <Button
              type="submit"
              className="w-full justify-start"
              variant="outline"
              size="sm"
              data-press="draft"
            >
              <MessageSquarePlus className="mr-2 size-4" />
              Start a page
              <small data-press="shortcut">⌘K</small>
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
              {ordered.map((c) => {
                const active = params?.id === c.id;
                const heading = headings.get(c.id);
                const edition = editionHeaderAt.get(c.id);
                const startsLoose = looseHeaderAt === c.id;
                return (
                  /* The section rule is a SIBLING of the card, not a child of
                     it — nested inside, it sat within the card's border and
                     read as part of the first conversation. */
                  <Fragment key={c.id}>
                    {edition ? (
                      <li
                        data-press="divider"
                        data-edition="true"
                        role="presentation"
                        /* The heading truncates in a 220px column, so the full
                           name has to be readable somehow. */
                        title={edition.name}
                      >
                        {edition.name}
                      </li>
                    ) : null}
                    {startsLoose ? (
                      <li data-press="divider" data-loose="true" role="presentation">
                        Loose pages
                      </li>
                    ) : null}
                    {heading ? (
                      <li data-press="divider" role="presentation">
                        {heading}
                      </li>
                    ) : null}
                    <li
                      className="group relative"
                      data-press="slip"
                      data-active={active ? 'true' : 'false'}
                    >
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

                          {/*
                            The stamp line, and the card's actions at the end of
                            it.

                            They used to be absolutely positioned over the card,
                            vertically centred — which put them ON TOP of the
                            title, and a long title ran underneath them. Given a
                            place in the flow at the end of the meta row, they
                            cannot overlap anything: the title has the full width
                            of the card and the actions have their own.
                          */}
                          <div data-press="stamp">
                            <span
                              data-press="square"
                              data-filled={(c.pressSlot ?? 0) % 2 === 0 ? 'true' : 'false'}
                            />
                            <span data-press="stamp-text">
                              {c.modelName ?? 'No model'}
                              {' · '}
                              {c.messageCount
                                ? `${c.messageCount} note${c.messageCount === 1 ? '' : 's'}`
                                : 'blank'}
                            </span>

                            <span data-press="slip-actions">
                              <EditionPicker
                                conversationId={c.id}
                                editionId={c.editionId}
                                editions={editions}
                              />
                              <button
                                type="button"
                                data-press="slip-action"
                                data-on={c.pinned ? 'true' : 'false'}
                                aria-label={c.pinned ? 'Unpin conversation' : 'Pin conversation'}
                                onClick={() =>
                                  startTransition(() => void togglePin(c.id, !c.pinned))
                                }
                              >
                                {c.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                              </button>
                              <button
                                type="button"
                                data-press="slip-action"
                                data-danger="true"
                                aria-label="Delete conversation"
                                onClick={() => {
                                  void (async () => {
                                    const ok = await confirm({
                                      title: `Delete "${c.title}"?`,
                                      body: 'This cannot be undone.',
                                      confirmLabel: 'Delete',
                                      destructive: true,
                                    });
                                    if (ok) startTransition(() => void deleteConversation(c.id));
                                  })();
                                }}
                              >
                                <Trash2 aria-hidden />
                              </button>
                            </span>
                          </div>
                        </>
                      )}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>
    </>
  );
}
