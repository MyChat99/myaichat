import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/security/auth';

import { signOut } from '../(auth)/actions';

/**
 * Protected shell. Middleware already redirects anonymous visitors, but this
 * re-checks server-side — middleware is a convenience gate, not the boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <Link href="/" className="font-semibold">
          myaichat
        </Link>

        <nav className="flex items-center gap-3">
          {user.role === 'admin' ? (
            <Link
              href="/admin"
              className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
            >
              Admin
            </Link>
          ) : null}

          <span className="text-muted-foreground hidden text-sm sm:inline">
            {user.displayName ?? user.email}
          </span>

          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
