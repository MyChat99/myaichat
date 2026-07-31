import {
  BarChart3,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { requireAdmin } from '@/lib/security/auth';

export const metadata: Metadata = { title: 'Admin' };

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/providers', label: 'Providers', icon: KeyRound },
  { href: '/admin/models', label: 'Models', icon: SlidersHorizontal },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/settings', label: 'Settings', icon: Settings2 },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

/**
 * Admin shell.
 *
 * `requireAdmin()` here covers every nested page — but each page calls it too.
 * A layout is not an authorisation boundary on its own: a future route added
 * outside this subtree, or a change to how layouts compose, would silently
 * lose the gate.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <nav className="border-border shrink-0 border-b p-3 md:w-56 md:border-r md:border-b-0">
        <p className="text-muted-foreground px-2 pb-2 text-xs font-medium uppercase">Admin</p>
        <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {NAV.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition"
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">{children}</div>
      </div>
    </div>
  );
}
