import Link from 'next/link';

import { Sidebar, type SidebarConversation } from '@/components/chat/sidebar';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/db/server';
import { AvatarExpand } from '@/components/ui/avatar-expand';
import { dayGroup } from '@/lib/time';
import { registeredProviderNames } from '@/lib/providers/registry';
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

        {user.suspended ? (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive border-b px-4 py-2 text-sm"
          >
            {/* Says what is true, and what to do about it. Without the second
                sentence the banner is a dead end: a suspended user can see
                that they are blocked and has no idea who lifted the rope. */}
            Your account is suspended. You can read your history but cannot send new messages.
            Contact an administrator to have it restored.
          </p>
        ) : null}

        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
