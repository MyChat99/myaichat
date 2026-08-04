import Link from 'next/link';

import { CommandPalette } from '@/components/command/command-palette';
import { Sidebar, type SidebarConversation } from '@/components/chat/sidebar';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/db/server';
import { AvatarExpand } from '@/components/ui/avatar-expand';
import { dayGroup } from '@/lib/time';
import { listAvailableModels, registeredProviderNames } from '@/lib/providers/registry';
import { requireUser } from '@/lib/security/auth';

import { signOut } from '../(auth)/actions';

/**
 * Protected shell. Middleware already redirects anonymous visitors, but this
 * re-checks server-side — middleware is a convenience gate, not the boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();

  // Resolved here so the printed treatment's COPY is server-rendered rather
  // than revealed by CSS. `loadAppearance` is request-cached, so this shares
  // the read the root layout already did.

  // Press slots, so the sidebar can distinguish two providers without naming
  // either. Registry order is stable, so a conversation keeps its mark.
  const pressSlots = new Map(registeredProviderNames().map((name, i) => [name, i]));
  const now = new Date();

  // RLS scopes this to the signed-in user; no explicit user_id filter needed.
  //
  // The model name and message count are embedded rather than fetched per row:
  // PostgREST resolves both in the same round trip, where a count per
  // conversation from the client would be 200 requests to render a sidebar.
  /*
   * Issued together, not one after the other.
   *
   * The conversation list and the edition list are independent — neither reads
   * the other's result — so awaiting them in sequence adds a whole round trip
   * to every authenticated page render for no reason. `verify:routes` exists to
   * catch exactly this and caught it here: adding the editions query as a third
   * sequential await was a straight regression of the Tier 0 work that removed
   * the chain in the first place.
   */
  const [{ data }, { data: editionRows }] = await Promise.all([
    supabase
      .from('conversations')
      .select(
        'id, title, pinned, updated_at, edition_id, models(display_name, providers(name)), messages(count)',
      )
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase.from('editions').select('id, name').order('created_at', { ascending: true }),
  ]);

  // No cast: the embed is typed from the foreign keys declared in
  // lib/db/types.ts, so a column that stops existing is a compile error rather
  // than an undefined at runtime.
  // Ordered oldest-first so the sidebar's sections do not reshuffle every time
  // one is renamed.
  const editions = editionRows ?? [];

  // Offered by the palette on every page. Empty on a deployment with no keys,
  // which the palette renders as simply having no model section.
  const paletteModels = (await listAvailableModels()).map((m) => ({
    id: m.id,
    displayName: m.displayName,
    providerName: m.providerName,
  }));

  const conversations: SidebarConversation[] = (data ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    pinned: c.pinned,
    updated_at: c.updated_at,
    editionId: c.edition_id,
    modelName: c.models?.display_name ?? null,
    pressSlot: pressSlots.get(c.models?.providers?.name ?? '') ?? null,
    messageCount: c.messages?.[0]?.count ?? 0,
    // Grouped on the server so every visitor sees the same buckets. Doing it in
    // the browser would classify by the reader's clock, which is arguably more
    // correct and definitely a hydration mismatch.
    // Bucketed in UTC for the first paint; the sidebar re-buckets in the
    // reader's own zone once it hydrates. See dayGroup().
    group: dayGroup(c.updated_at, now, true),
  }));

  return (
    /**
     * `h-dvh`, not `min-h-full`.
     *
     * This shell is a fixed frame with its own scrollers inside it — the
     * conversation list scrolls, the message list scrolls, the settings form
     * scrolls. `min-h-full` let the shell GROW past the viewport instead of
     * bounding those scrollers, so on any page whose content was taller than
     * the window the document scrolled instead: the header and the whole
     * sidebar scrolled up out of view, leaving the content beside empty space.
     *
     * `dvh` rather than `vh` because on mobile `vh` is the height with the
     * browser chrome hidden, which leaves the composer under the URL bar.
     *
     * No `flex-1` here either. In a column flex container `flex-1` sets
     * `flex-basis: 0%`, and the basis IS the height — so it silently overrode
     * `h-dvh` and the shell went back to sizing itself from its content.
     */
    <div className="flex h-dvh overflow-hidden">
      {/*
        Mounted HERE, not in the chat thread.

        Cmd+K and `?` were bound inside ChatThread, so they worked on chat pages
        and nowhere else — Appearance, Profile and Admin had no palette and no
        shortcuts help at all. A global shortcut that is only global on one
        route is worse than none: it teaches a habit that then fails.

        Model selection is bridged by an event rather than a prop, because this
        shell has no chat state to change. On a chat page ChatThread listens; on
        any other page the model list simply is not offered.
      */}
      <CommandPalette
        conversations={conversations.map((c) => ({ id: c.id, title: c.title }))}
        models={paletteModels}
      />

      <Sidebar
        conversations={conversations}
        editions={editions}
        issue={{ since: user.createdAt, now: now.toISOString() }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-press="masthead-bar"
          className="border-border flex items-center justify-between border-b py-3 pr-4 pl-14 md:pl-4"
        >
          <Link href="/" className="font-semibold" data-press="lockup">
            <span data-press="mark" aria-hidden="true">
              ¶
            </span>
            Pilcrow
          </Link>

          {/* Wraps rather than overflowing: at 360px the four links plus the
              sign-out button do not fit on one line, and an overflowing header
              pushes the horizontal scrollbar onto the whole page. */}
          <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <Link
              href="/compare"
              className="text-muted-foreground hover:text-foreground inline-flex min-h-6 items-center text-sm underline-offset-4 hover:underline"
            >
              Presses
            </Link>

            <Link
              href="/profile"
              className="text-muted-foreground hover:text-foreground inline-flex min-h-6 items-center text-sm underline-offset-4 hover:underline"
            >
              Profile
            </Link>

            <Link
              href="/settings"
              className="text-muted-foreground hover:text-foreground inline-flex min-h-6 items-center text-sm underline-offset-4 hover:underline"
            >
              Appearance
            </Link>

            {user.role === 'admin' ? (
              <Link
                href="/admin"
                className="text-muted-foreground hover:text-foreground inline-flex min-h-6 items-center text-sm underline-offset-4 hover:underline"
              >
                Admin
              </Link>
            ) : null}

            {/* Show the email when the display name would duplicate the nav link. */}
            <AvatarExpand avatarKey={user.avatarUrl} seed={user.id} label={user.email ?? 'You'} />

            <span
              className="text-muted-foreground hidden text-sm sm:inline"
              title={user.email ?? ''}
            >
              {user.displayName && user.displayName.toLowerCase() !== 'admin'
                ? user.displayName
                : (user.email ?? user.displayName)}
            </span>

            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </nav>
        </header>

        {/*
          The suspended banner is gone, and it is gone because it is now
          unreachable rather than because it was wrong.

          It said "you can read your history but cannot send new messages",
          which was true when suspension was a read-only state. `requireUser`
          now bounces a suspended session to /login, so this shell never renders
          for one — leaving the markup would be dead code that reads like a
          supported state and would send the next person looking for a bug that
          cannot happen. The message it carried moved to the login form, which
          is where a revoked reader now lands.
        */}

        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
