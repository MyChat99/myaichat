import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/db/server';
import { withRequestLog, type RequestContext } from '@/lib/observability/log';
import { checkEndpointLimit, limitMessage } from '@/lib/security/endpoint-limit';

/**
 * Downloads one conversation as Markdown or JSON.
 *
 * Reads through the caller's own client, so RLS decides whether the
 * conversation exists for them — a foreign id returns no row and 404s, the same
 * answer a genuinely missing id gets. There is no ownership check written here
 * because there does not need to be one, and adding a second check that could
 * disagree with RLS would be worse than none.
 */

export const runtime = 'nodejs';

const paramsSchema = z.enum(['md', 'json']);

/** RFC 6266 — quotes and backslashes in a filename break the header. */
function contentDisposition(title: string, ext: string): string {
  const safe = title
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .toLowerCase();
  return `attachment; filename="${safe || 'conversation'}.${ext}"`;
}

function toMarkdown(
  conversation: { title: string; created_at: string },
  model: string | null,
  messages: { role: string; content: string; created_at: string; attachments: unknown }[],
): string {
  const lines = [
    `# ${conversation.title}`,
    '',
    `- **Exported** ${new Date().toISOString().slice(0, 10)}`,
    `- **Started** ${conversation.created_at.slice(0, 10)}`,
    `- **Model** ${model ?? 'unknown'}`,
    `- **Messages** ${messages.length}`,
    '',
    '---',
    '',
  ];

  for (const m of messages) {
    // "You" and the model name, not "user"/"assistant" — this file is read by a
    // person, and often pasted somewhere else.
    lines.push(`## ${m.role === 'user' ? 'You' : (model ?? 'Assistant')}`);
    lines.push('');
    lines.push(m.content);

    const files = Array.isArray(m.attachments) ? (m.attachments as { name?: string }[]) : [];
    if (files.length > 0) {
      lines.push('');
      // Names only. The bytes live in private storage behind a signed URL that
      // expires, so an embedded link would be broken by the time anyone read it.
      lines.push(`*Attachments: ${files.map((f) => f.name ?? 'file').join(', ')}*`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  ctx: RequestContext,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // Reported back so the log line carries it — it is not knowable before the
  // handler authenticates, which is why the context is mutable.
  ctx.userId = user.id;

  // An export reads an entire conversation and serialises it. Cheap once,
  // not cheap in a loop.
  const limited = await checkEndpointLimit(user.id, 'conversations.export');
  if (!limited.allowed) {
    return NextResponse.json(
      { error: limitMessage(limited) },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const format = paramsSchema.safeParse(request.nextUrl.searchParams.get('format') ?? 'md');
  if (!format.success) {
    return NextResponse.json({ error: 'Format must be md or json.' }, { status: 400 });
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, title, created_at, model_id')
    .eq('id', id)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { data: messages } = await supabase
    .from('messages')
    .select('role, content, created_at, attachments')
    .eq('conversation_id', id)
    .neq('role', 'system')
    // Same ordering the thread renders with, so an export cannot disagree with
    // what the user saw on screen.
    .order('seq', { ascending: true });

  // The model name is cosmetic here, so a missing row degrades to null rather
  // than failing the export.
  let modelName: string | null = null;
  if (conversation.model_id) {
    const { data: model } = await supabase
      .from('models')
      .select('display_name')
      .eq('id', conversation.model_id)
      .maybeSingle();
    modelName = model?.display_name ?? null;
  }

  const rows = messages ?? [];

  if (format.data === 'json') {
    const body = {
      title: conversation.title,
      model: modelName,
      startedAt: conversation.created_at,
      exportedAt: new Date().toISOString(),
      messages: rows.map((m) => ({
        role: m.role,
        content: m.content,
        at: m.created_at,
        attachments: Array.isArray(m.attachments) ? m.attachments : [],
      })),
    };

    return new NextResponse(JSON.stringify(body, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': contentDisposition(conversation.title, 'json'),
        'cache-control': 'no-store',
      },
    });
  }

  return new NextResponse(toMarkdown(conversation, modelName, rows), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': contentDisposition(conversation.title, 'md'),
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
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withRequestLog({ route: '/api/conversations/[id]/export', method: 'GET' }, (ctx) =>
    handleGET(request, context, ctx),
  );
}
