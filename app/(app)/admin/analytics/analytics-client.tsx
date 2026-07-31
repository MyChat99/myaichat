'use client';

import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type AnalyticsData = {
  range: string;
  truncated: boolean;
  totals: { messages: number; tokens: number; cost: number; activeUsers: number };
  messagesPerDay: { date: string; count: number }[];
  tokensByModel: { name: string; input: number; output: number }[];
  costByProvider: { name: string; cost: number }[];
};

/**
 * Charts read their colours from the theme's CSS variables rather than a fixed
 * palette, so they follow whichever of the seven themes is active instead of
 * being the one part of the app that ignores it.
 */
const SERIES = [
  'var(--primary)',
  'var(--muted-foreground)',
  'var(--success)',
  'var(--destructive)',
];

const RANGES = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

const axis = { stroke: 'var(--muted-foreground)', fontSize: 11 };

const tooltipStyle = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--popover-foreground)',
  fontSize: 12,
};

export function AnalyticsCharts({ data }: { data: AnalyticsData }) {
  const empty = data.totals.messages === 0;

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {RANGES.map((r) => (
          <Link
            key={r.id}
            href={`/admin/analytics?range=${r.id}`}
            className={`rounded-md border px-3 py-1.5 text-xs transition ${
              data.range === r.id ? 'bg-accent font-medium' : 'hover:bg-accent/60'
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {data.truncated ? (
        <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
          Showing the first 50,000 usage rows for this range — totals below are therefore a lower
          bound. Narrow the range for exact figures.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Messages" value={data.totals.messages.toLocaleString()} />
        <Stat label="Tokens" value={data.totals.tokens.toLocaleString()} />
        <Stat label="Estimated cost" value={`$${data.totals.cost.toFixed(2)}`} />
        <Stat label="Active users" value={data.totals.activeUsers.toLocaleString()} />
      </div>

      {empty ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No usage in this range yet. Send a few messages and the charts will fill in.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Messages per day</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.messagesPerDay}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" {...axis} tickLine={false} />
                  <YAxis {...axis} tickLine={false} allowDecimals={false} width={32} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                    name="Messages"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tokens by model</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.tokensByModel}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" {...axis} tickLine={false} />
                    <YAxis {...axis} tickLine={false} width={48} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="input" stackId="t" fill={SERIES[0]} name="Input" />
                    <Bar dataKey="output" stackId="t" fill={SERIES[1]} name="Output" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Estimated cost by provider</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.costByProvider}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" {...axis} tickLine={false} />
                    <YAxis {...axis} tickLine={false} width={56} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                    <Bar dataKey="cost" name="USD">
                      {data.costByProvider.map((_, i) => (
                        <Cell key={i} fill={SERIES[i % SERIES.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
