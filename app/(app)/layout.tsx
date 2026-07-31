import Link from 'next/link';

import { Sidebar, type SidebarConversation } from '@/components/chat/sidebar';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/db/server';
import { requireUser } from '@/lib/security/auth';

import { signOut } from '../(auth)/actions';

/**
 * Protected shell. Middleware already redirects anonymous visitors, but this
 * re-checks server-side — middleware is a convenience gate, not the boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();

  // RLS scopes this to the signed-in user; no explicit user_id filter needed.
  const { data } = await supabase
    .from('conversations')
    .select('id, title, pinned, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);

  const conversations = (data ?? []) as SidebarConversation[];

  return (
    <div className="flex min-h-full flex-1 overflow-hidden">
      <Sidebar conversations={conversations} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border flex items-center justify-between border-b py-3 pr-4 pl-14 md:pl-4">
          <Link href="/" className="font-semibold">
            myaichat
          </Link>

          <nav className="flex items-center gap-3">
            <Link
              href="/settings"
              className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
            >
              Appearance
            </Link>

            {user.role === 'admin' ? (
              <Link
                href="/admin"
                className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
              >
                Admin
              </Link>
            ) : null}

            {/* Show the email when the display name would duplicate the nav link. */}
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
            Your account is suspended. You can read your history but cannot send new messages.
          </p>
        ) : null}

        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
