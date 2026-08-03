'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { signOut } from '@/app/(auth)/actions';
import { AvatarExpand } from '@/components/ui/avatar-expand';

/**
 * Section tabs, set in the folio rule beside the page title.
 *
 * The mockup gives the page ONE top bar: title and model ticket on the left,
 * sections on the right. The application normally has two — a header carrying
 * navigation, and a rule carrying the model selector — because navigation lives
 * in the layout and the model selector's state lives in the thread.
 *
 * Rather than lift that state into the layout, the navigation comes down here,
 * and riso.css hides the header on any page that renders a rule bar:
 *
 *   html[data-theme='riso'] body:has([data-press='rule']) header { display: none }
 *
 * `:has()` does that at first paint with no JavaScript and no flash, and it
 * cannot hide the header on a page that has no replacement for it — settings,
 * profile and admin keep their header, styled as the same tabs.
 */
export function SectionTabs({
  isAdmin,
  avatarKey = null,
  avatarSeed,
  email = null,
}: {
  isAdmin: boolean;
  avatarKey?: string | null;
  /** The user id, so an unchosen portrait is still distinct per person. */
  avatarSeed?: string;
  email?: string | null;
}) {
  const pathname = usePathname();

  const tabs = [
    { href: '/', label: 'Page', match: (p: string) => p === '/' || p.startsWith('/c/') },
    { href: '/compare', label: 'Presses', match: (p: string) => p.startsWith('/compare') },
    { href: '/profile', label: 'Profile', match: (p: string) => p.startsWith('/profile') },
    { href: '/settings', label: 'Appearance', match: (p: string) => p.startsWith('/settings') },
    ...(isAdmin
      ? [{ href: '/admin', label: 'Admin', match: (p: string) => p.startsWith('/admin') }]
      : []),
  ];

  return (
    <nav data-press="tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          data-press="tab"
          data-on={tab.match(pathname ?? '') ? 'true' : 'false'}
        >
          {tab.label}
        </Link>
      ))}
      {/*
        Only when there is an actual portrait to show.
        A generic person glyph in the navigation is a placeholder for something
        that may never arrive — it reads as an unfinished control sitting
        between Admin and Sign out. A real uploaded avatar is a different thing
        and still belongs here; an empty frame does not.
      */}
      {/*
        The SAME expandable portrait the masthead uses, and rendered
        UNCONDITIONALLY. It used to be gated on `avatarKey` because a generic
        person glyph in the navigation reads as an unfinished control. Preset
        marks removed that objection: with nothing stored the reader now gets a
        mark seeded from their id, which is a portrait rather than a placeholder,
        so hiding it would hide the feature from exactly the people it is for.

        This is also the copy actually on screen while chatting —
        `body:has([data-press='tabs'])` hides the masthead wherever these tabs
        render.
      */}
      <AvatarExpand avatarKey={avatarKey} seed={avatarSeed} label={email ?? 'You'} />

      {/* A server action invoked from a client component — the form posts, so
          signing out still works with JavaScript disabled. */}
      <form action={signOut}>
        <button type="submit" data-press="tab">
          Sign out
        </button>
      </form>
    </nav>
  );
}
