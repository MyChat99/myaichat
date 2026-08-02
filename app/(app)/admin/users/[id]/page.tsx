import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getUserUsage, USAGE_ROW_CAP } from '@/lib/admin/user-usage';
import { createAdminClient } from '@/lib/db/admin';
import { requireAdmin } from '@/lib/security/auth';

export const metadata: Metadata = { title: 'User usage' };

function money(value: number): string {
  if (value === 0) return '$0.00';
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function when(iso: string | null): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  // Relative for the recent past, absolute beyond that. The absolute form is
  // pinned to UTC so the server's markup is deterministic; it is a coarse
  // "3 Aug 2026" where a day either way does not change the meaning, unlike
  // the masthead and the audit log, which are rendered in the reader's zone.
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function UserUsagePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  // A non-UUID would otherwise reach Postgres and surface as a driver error.
  if (!z.string().uuid().safeParse(id).success) notFound();

  const db = createAdminClient();

  const [{ data: profile }, authUser, usage] = await Promise.all([
    db
      .from('profiles')
      .select('display_name, role, suspended, created_at')
      .eq('id', id)
      .maybeSingle(),
    db.auth.admin.getUserById(id),
    getUserUsage(id),
  ]);

  if (!profile) notFound();

  const email = authUser.data?.user?.email ?? null;
  const capped = usage.totals.messages >= USAGE_ROW_CAP;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/users"
          className="text-muted-foreground hover:text-foreground inline-flex min-h-6 items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All users
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold break-all">
            {profile.display_name || email || 'Unnamed user'}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm break-all">{email ?? 'no email'}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Badge variant={profile.role === 'admin' ? 'default' : 'secondary'}>{profile.role}</Badge>
          {profile.suspended ? <Badge variant="destructive">suspended</Badge> : null}
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Spend, 30 days', value: money(usage.totals.costUsd) },
          {
            label: 'Tokens, 30 days',
            value: (usage.totals.inputTokens + usage.totals.outputTokens).toLocaleString(),
            hint: `${usage.totals.inputTokens.toLocaleString()} in · ${usage.totals.outputTokens.toLocaleString()} out`,
          },
          { label: 'Conversations', value: usage.totals.conversations.toLocaleString() },
          { label: 'Last active', value: when(usage.lastActiveAt) },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{stat.value}</div>
              {stat.hint ? <p className="text-muted-foreground mt-1 text-xs">{stat.hint}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">By model, last 30 days</CardTitle>
          {capped ? (
            <p className="text-muted-foreground text-xs">
              Showing the most recent {USAGE_ROW_CAP.toLocaleString()} usage rows. Totals below that
              cap are complete; this account is above it.
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {usage.byModel.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No recorded usage in the last 30 days. Conversations may still exist — usage is only
              written when a model actually generates.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground border-b text-xs">
                  <tr>
                    <th className="pb-2 font-medium">Model</th>
                    <th className="pb-2 text-right font-medium">Messages</th>
                    <th className="pb-2 text-right font-medium">Tokens</th>
                    <th className="pb-2 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {usage.byModel.map((row) => (
                    <tr key={row.modelId ?? 'unknown'}>
                      <td className="py-2">
                        <span className="font-medium">{row.displayName}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {row.providerName}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {row.messages.toLocaleString()}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {(row.inputTokens + row.outputTokens).toLocaleString()}
                      </td>
                      <td className="py-2 text-right tabular-nums">{money(row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
