import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/db/admin';
import { createClient } from '@/lib/db/server';
import { ALLOWED_MIME, buildObjectKey, isStorageConfigured, presignUpload } from '@/lib/r2/storage';

/**
 * Issues a short-lived presigned upload URL.
 *
 * ORDER MATTERS HERE. Auth, then suspension, then rate limit, then file
 * validation — and only then does storage get touched. Every rejection path is
 * therefore exercisable without R2 credentials, and a caller cannot use a
 * validation failure to probe whether storage exists.
 */

export const runtime = 'nodejs';

const MAX_FALLBACK_MB = 20;
/** Uploads are cheap but not free; this bounds abuse without annoying real use. */
const MAX_UPLOADS_PER_HOUR = 60;

const bodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(128),
  sizeBytes: z.number().int().positive(),
  scope: z.enum(['chat', 'avatar']).default('chat'),
});

async function maxUploadBytes(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', 'max_upload_size_mb')
    .maybeSingle();

  const mb = typeof data?.value === 'number' && data.value > 0 ? data.value : MAX_FALLBACK_MB;
  return mb * 1024 * 1024;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('suspended')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.suspended) {
    return NextResponse.json({ error: 'Your account is suspended.' }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  // Rate limit before doing any work that costs money or storage.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();
  const { count } = await admin
    .from('audit_logs')
    .select('*', { count: 'exact', head: true })
    .eq('actor_id', user.id)
    .eq('action', 'upload.presigned')
    .gte('created_at', since);

  if ((count ?? 0) >= MAX_UPLOADS_PER_HOUR) {
    return NextResponse.json(
      { error: `Upload limit of ${MAX_UPLOADS_PER_HOUR} per hour reached.` },
      { status: 429, headers: { 'retry-after': '3600' } },
    );
  }

  const allowed = ALLOWED_MIME[body.mimeType];
  if (!allowed) {
    return NextResponse.json(
      { error: `Files of type ${body.mimeType} are not accepted.` },
      { status: 415 },
    );
  }

  // Avatars must be images regardless of what else the allow-list permits.
  if (body.scope === 'avatar' && allowed.kind !== 'image') {
    return NextResponse.json({ error: 'An avatar must be an image.' }, { status: 415 });
  }

  const limit = await maxUploadBytes();
  if (body.sizeBytes > limit) {
    return NextResponse.json(
      { error: `Files must be ${Math.floor(limit / 1024 / 1024)}MB or smaller.` },
      { status: 413 },
    );
  }

  // Everything above is enforceable without storage. Only now does R2 matter.
  if (!isStorageConfigured()) {
    return NextResponse.json(
      {
        error: 'File uploads are not configured on this deployment.',
        code: 'storage_unconfigured',
      },
      { status: 503 },
    );
  }

  const key = buildObjectKey(user.id, body.scope, `${body.filename}.${allowed.ext}`);

  try {
    const uploadUrl = await presignUpload(key, body.mimeType, body.sizeBytes);

    // Recorded so the rate limit above has something to count, and so uploads
    // are attributable.
    await admin.from('audit_logs').insert({
      actor_id: user.id,
      action: 'upload.presigned',
      target_type: 'attachment',
      target_id: key,
      metadata: { mimeType: body.mimeType, sizeBytes: body.sizeBytes, scope: body.scope },
    });

    return NextResponse.json({
      uploadUrl,
      key,
      kind: allowed.kind,
    });
  } catch (err) {
    console.error('[uploads/presign] failed:', err);
    return NextResponse.json({ error: 'Could not prepare the upload.' }, { status: 500 });
  }
}
