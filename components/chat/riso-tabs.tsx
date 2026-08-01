'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { signOut } from '@/app/(auth)/actions';

/**
 * Riso's section tabs, set in the folio rule beside the page title.
 *
 * The mockup gives the page ONE top bar: title and model ticket on the left,
 * sections on the right. The application normally has two — a header carrying
 * navigation, and a rule carrying the model selector — because navigation lives
 * in the layout and the model selector's state lives in the thread.
 *
 * Rather than lift that state into the layout, the navigation comes down here,
 * and riso.css hides the header on any page that renders a rule bar:
 *
 *   html[data-theme='riso'] body:has([data-riso='rule']) header { display: none }
 *
 * `:has()` does that at first paint with no JavaScript and no flash, and it
 * cannot hide the header on a page that has no replacement for it — settings,
 * profile and admin keep their header, styled as the same tabs.
 */
export function RisoTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const tabs = [
    { href: '/', label: 'Page', match: (p: string) => p === '/' || p.startsWith('/c/') },
    { href: '/profile', label: 'Profile', match: (p: string) => p.startsWith('/profile') },
    { href: '/settings', label: 'Appearance', match: (p: string) => p.startsWith('/settings') },
    ...(isAdmin
      ? [{ href: '/admin', label: 'Admin', match: (p: string) => p.startsWith('/admin') }]
      : []),
  ];

  return (
    <nav data-riso="tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          data-riso="tab"
          data-on={tab.match(pathname ?? '') ? 'true' : 'false'}
        >
          {tab.label}
        </Link>
      ))}
      {/* A server action invoked from a client component — the form posts, so
          signing out still works with JavaScript disabled. */}
      <form action={signOut}>
        <button type="submit" data-riso="tab">
          Sign out
        </button>
      </form>
    </nav>
  );
}
