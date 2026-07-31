import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, MessagesSquare, Users, Wallet, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDashboardStats } from '@/lib/admin/dashboard';
import { requireAdmin } from '@/lib/security/auth';

export const metadata: Metadata = { title: 'Overview' };

/** Costs are fractions of a cent; two decimals would render every figure as $0.00. */
function money(value: number): string {
  if (value === 0) return '$0.00';
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'warn';
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </CardTitle>
        <Icon
          className={`size-4 ${tone === 'warn' ? 'text-destructive' : 'text-muted-foreground'}`}
        />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const stats = await getDashboardStats();

  const down = stats.providers.filter((p) => p.ok === false);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Today is measured from 00:00 UTC, the same boundary the per-user token budget uses.
        </p>
      </header>

      {down.length > 0 ? (
        <div className="border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-lg border p-3">
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">
              {down.length === 1
                ? `${down[0]!.name} is not responding`
                : `${down.length} providers are not responding`}
            </p>
            <p className="text-muted-foreground mt-0.5">
              Chat using {down.length === 1 ? 'that provider' : 'those providers'} will fail.{' '}
              <Link href="/admin/providers" className="underline underline-offset-4">
                Check the keys
              </Link>
              .
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Messages today"
          value={stats.today.messages.toLocaleString()}
          hint={`${stats.today.activeUsers} active user${stats.today.activeUsers === 1 ? '' : 's'}`}
          icon={MessagesSquare}
        />
        <Stat
          label="Cost today"
          value={money(stats.today.costUsd)}
          hint={`${stats.today.tokens.toLocaleString()} tokens`}
          icon={Wallet}
        />
        <Stat
          label="Cost, 30 days"
          value={money(stats.month.costUsd)}
          hint={`${stats.month.messages.toLocaleString()} messages`}
          icon={Wallet}
        />
        <Stat
          label="Users"
          value={stats.users.total.toLocaleString()}
          hint={`${stats.users.admins} admin${stats.users.admins === 1 ? '' : 's'}${
            stats.users.suspended > 0 ? ` · ${stats.users.suspended} suspended` : ''
          }`}
          icon={Users}
          tone={stats.users.suspended > 0 ? 'warn' : undefined}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Providers</CardTitle>
          <p className="text-muted-foreground text-xs">
            Checked with a real one-token generation, cached for five minutes. A key with no credit
            authenticates and lists models perfectly well — only generating proves it works.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {stats.providers.map((provider) => (
            <div
              key={provider.name}
              className="border-border flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {provider.ok ? (
                  <CheckCircle2 className="text-success size-4 shrink-0" aria-hidden />
                ) : (
                  <XCircle className="text-destructive size-4 shrink-0" aria-hidden />
                )}
                <span className="text-sm font-medium">{provider.name}</span>
                <span className="text-muted-foreground truncate text-xs">{provider.message}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {provider.latencyMs !== null ? (
                  <Badge variant="secondary" className="tabular-nums">
                    {provider.latencyMs}ms
                  </Badge>
                ) : null}
              </div>
            </div>
          ))}
          {stats.providers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No providers registered. Run <code>npm run seed</code>.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
