import { LocalTime } from '@/components/ui/local-time';
import { Download } from 'lucide-react';
import Link from 'next/link';

import { createAdminClient } from '@/lib/db/admin';
import { requireAdmin } from '@/lib/security/auth';

/**
 * Audit log viewer — filterable and paginated.
 *
 * Server-rendered with keyset-free offset paging: the table is admin-only and
 * bounded by a date index, so offsets stay cheap at the sizes this will reach.
 */

const PAGE_SIZE = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const page = Math.max(0, Number(params.page ?? 0) || 0);
  const action = params.action?.trim() || null;

  const db = createAdminClient();

  let query = db
    .from('audit_logs')
    .select('id, actor_id, action, target_type, target_id, ip, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (action) query = query.eq('action', action);

  const [{ data: logs, count }, { data: allActions }] = await Promise.all([
    query,
    db.from('audit_logs').select('action').limit(1000),
  ]);

  const actions = [...new Set((allActions ?? []).map((a) => a.action))].sort();

  // Resolve actor emails in one round trip rather than per row.
  const { data: authUsers } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? null]));

  const total = count ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Audit log</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Every admin mutation, written server-side with the secret key so entries cannot be
            forged from a browser. {total.toLocaleString()} entries.
          </p>
        </div>

        {/* A plain anchor: the browser already knows how to save a response with
            a content-disposition header, and the export itself is audited. */}
        <a
          href="/api/admin/audit/export?days=90"
          download
          className="border-border hover:bg-accent inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition"
        >
          <Download className="size-3.5" aria-hidden />
          Export CSV
        </a>
      </header>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/audit"
          className={`rounded-md border px-3 py-1.5 text-xs transition ${
            !action ? 'bg-accent font-medium' : 'hover:bg-accent/60'
          }`}
        >
          All
        </Link>
        {actions.map((a) => (
          <Link
            key={a}
            href={`/admin/audit?action=${encodeURIComponent(a)}`}
            className={`rounded-md border px-3 py-1.5 font-mono text-xs transition ${
              action === a ? 'bg-accent font-medium' : 'hover:bg-accent/60'
            }`}
          >
            {a}
          </Link>
        ))}
      </div>

      {(logs ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">No entries match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {(logs ?? []).map((log) => (
                <tr key={log.id} className="border-t">
                  <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                    <LocalTime iso={log.created_at} style="dateTime" />
                  </td>
                  <td className="px-3 py-2">
                    {log.actor_id ? (emailById.get(log.actor_id) ?? log.actor_id.slice(0, 8)) : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono">{log.action}</td>
                  <td className="text-muted-foreground max-w-[16rem] truncate px-3 py-2">
                    {log.target_type ? `${log.target_type}: ${log.target_id ?? '—'}` : '—'}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 font-mono">{log.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Page {page + 1} of {lastPage + 1}
          </span>
          <div className="flex gap-2">
            {page > 0 ? (
              <Link
                href={`/admin/audit?${action ? `action=${encodeURIComponent(action)}&` : ''}page=${page - 1}`}
                className="hover:bg-accent rounded-md border px-3 py-1.5"
              >
                Previous
              </Link>
            ) : null}
            {page < lastPage ? (
              <Link
                href={`/admin/audit?${action ? `action=${encodeURIComponent(action)}&` : ''}page=${page + 1}`}
                className="hover:bg-accent rounded-md border px-3 py-1.5"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
