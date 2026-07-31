import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/db/admin';
import { withRequestLog, type RequestContext } from '@/lib/observability/log';
import { auditLog } from '@/lib/security/audit';
import { requireAdmin } from '@/lib/security/auth';
import { checkEndpointLimit, limitMessage } from '@/lib/security/endpoint-limit';

/**
 * Audit log as CSV.
 *
 * The audit trail exists to be read by someone who is not looking at this app —
 * a reviewer, an auditor, whoever asks "who changed that key". CSV because the
 * tool on the other end is a spreadsheet, not a JSON viewer.
 *
 * Exporting the audit log is itself audited. That reads as circular and is not:
 * pulling a full record of every administrative action is exactly the kind of
 * event a later reviewer wants to see, and an export that leaves no trace is a
 * gap in the thing it is exporting.
 */

export const runtime = 'nodejs';

const MAX_ROWS = 10_000;

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
  action: z.string().trim().max(64).optional(),
});

/**
 * RFC 4180 escaping.
 *
 * The specific hazard: a value beginning `=`, `+`, `-` or `@` is interpreted by
 * Excel and Sheets as a FORMULA. An audit row whose metadata contains
 * `=HYPERLINK(...)` becomes a live link in the reviewer's spreadsheet — CSV
 * injection, and an audit export is precisely where attacker-influenced text
 * meets a trusting reader. Prefixing a quote neutralises it while leaving the
 * value readable.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  // Quote if it contains anything that would break the row, and double any
  // embedded quotes.
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;

  return text;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

async function handleGET(request: NextRequest, ctx: RequestContext) {
  const admin = await requireAdmin();
  ctx.userId = admin.id;

  const limited = await checkEndpointLimit(admin.id, 'admin.audit_export');
  if (!limited.allowed) {
    return NextResponse.json(
      { error: limitMessage(limited) },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSeconds) } },
    );
  }

  const parsed = querySchema.safeParse({
    days: request.nextUrl.searchParams.get('days') ?? undefined,
    action: request.nextUrl.searchParams.get('action') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid range.' }, { status: 400 });
  }

  const since = new Date(Date.now() - parsed.data.days * 86_400_000).toISOString();
  const db = createAdminClient();

  let query = db
    .from('audit_logs')
    .select('created_at, actor_id, action, target_type, target_id, ip, metadata')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);

  if (parsed.data.action) query = query.eq('action', parsed.data.action);

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ error: 'Could not read the audit log.' }, { status: 500 });
  }

  // Actor ids are UUIDs; a reviewer needs the address. One lookup for the whole
  // export rather than one per row.
  const { data: authUsers } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? '']));

  const header = [
    'timestamp',
    'actor_email',
    'actor_id',
    'action',
    'target_type',
    'target_id',
    'ip',
    'metadata',
  ];

  const lines = [
    csvRow(header),
    ...(rows ?? []).map((row) =>
      csvRow([
        row.created_at,
        row.actor_id ? (emailById.get(row.actor_id) ?? '') : '',
        row.actor_id,
        row.action,
        row.target_type,
        row.target_id,
        row.ip,
        row.metadata,
      ]),
    ),
  ];

  await auditLog({
    actorId: admin.id,
    action: 'audit.exported',
    targetType: 'audit_logs',
    metadata: { days: parsed.data.days, rows: rows?.length ?? 0, action: parsed.data.action },
  });

  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(lines.join('\r\n'), {
    headers: {
      // RFC 4180 says text/csv; the charset matters because metadata can carry
      // non-ASCII and Excel guesses badly without it.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

/**
 * One structured log line per request, with the id echoed as `x-request-id`.
 *
 * The wrapper existed and was tested for a whole session without being called
 * anywhere — tested dead code, which is worse than none: the suite reported
 * that request logging worked while four routes logged nothing at all.
 */
export async function GET(request: NextRequest) {
  return withRequestLog({ route: '/api/admin/audit/export', method: 'GET' }, (ctx) =>
    handleGET(request, ctx),
  );
}
