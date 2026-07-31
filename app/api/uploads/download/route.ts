import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/db/server';
import { isStorageConfigured, keyBelongsToUser, presignDownload } from '@/lib/r2/storage';
import { checkEndpointLimit, limitMessage } from '@/lib/security/endpoint-limit';

/**
 * Redirects to a short-lived presigned GET.
 *
 * The bucket is private, so this route is the ONLY way to read an object — and
 * it checks ownership before signing anything. The object-key prefix carries
 * the owner's id, which is what makes that check a string comparison rather
 * than a database round trip.
 */

export const runtime = 'nodejs';

const querySchema = z.object({ key: z.string().trim().min(1).max(512) });

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const parsed = querySchema.safeParse({ key: request.nextUrl.searchParams.get('key') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  // This route had no limit at all: the previous approach counted `audit_logs`
  // rows, and downloads are not audited, so there was nothing to count. Each
  // call signs a URL and bills R2 egress.
  const limited = await checkEndpointLimit(user.id, 'uploads.download');
  if (!limited.allowed) {
    return NextResponse.json(
      { error: limitMessage(limited) },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSeconds) } },
    );
  }

  const { key } = parsed.data;

  // 404 rather than 403: telling a caller that someone else's file exists is
  // itself a disclosure.
  if (!keyBelongsToUser(key, user.id)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: 'File storage is not configured.', code: 'storage_unconfigured' },
      { status: 503 },
    );
  }

  try {
    const url = await presignDownload(key);
    // 302 rather than returning the URL as JSON: the browser follows it for
    // <img> and download links without any client code.
    return NextResponse.redirect(url, { status: 302 });
  } catch (err) {
    console.error('[uploads/download] failed:', err);
    return NextResponse.json({ error: 'Could not prepare the download.' }, { status: 500 });
  }
}
