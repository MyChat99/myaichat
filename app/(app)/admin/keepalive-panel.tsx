'use client';

import { useState, useTransition } from 'react';

import { pingDatabase } from '@/app/(app)/admin/actions';
import { Button } from '@/components/ui/button';

type Status = {
  daysSince: number | null;
  level: 'ok' | 'warn' | 'critical' | 'unknown';
  message: string;
  lastActivityAt: string | null;
};

/**
 * The database keep-alive, as an operator sees it.
 *
 * Shows the standing state on load and lets it be checked deliberately. The
 * button reports latency because "it worked" and "it worked in 40ms" are
 * different pieces of news when a project has been idle — the second says the
 * database is warm, the first only says it eventually answered.
 */
export function KeepAlivePanel({ initial }: { initial: Status }) {
  const [status, setStatus] = useState(initial);
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tone =
    status.level === 'critical'
      ? 'text-destructive'
      : status.level === 'warn'
        ? 'text-destructive'
        : 'text-muted-foreground';

  return (
    <section className="border-border rounded-lg border p-4" data-press="panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Database keep-alive</h2>
        <p className={`text-xs ${tone}`} data-press="keepalive-status">
          {status.message}
        </p>
      </div>

      <p className="text-muted-foreground mt-2 text-xs">
        A free Supabase project pauses after about a week without activity, which takes the whole
        site down. Every visit touches it, including the signed-out sign-in page.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          data-press="ping-button"
          onClick={() =>
            startTransition(async () => {
              const r = await pingDatabase();
              setResult(
                r.ok
                  ? `Reached the database in ${r.latencyMs}ms.`
                  : `Could not reach the database: ${r.error ?? 'unknown error'}`,
              );
              if (r.ok && r.lastActivityAt) {
                setStatus({
                  daysSince: 0,
                  level: 'ok',
                  message: 'Last touched just now.',
                  lastActivityAt: r.lastActivityAt,
                });
              }
            })
          }
        >
          {pending ? 'Pinging…' : 'Ping'}
        </Button>

        {result ? (
          <p className="text-xs" role="status" data-press="ping-result">
            {result}
          </p>
        ) : null}
      </div>
    </section>
  );
}
