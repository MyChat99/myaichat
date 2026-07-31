import 'server-only';

import { createAdminClient } from '@/lib/db/admin';
import { FALLBACK_MAX_UPLOAD_MB } from '@/lib/upload/types';

/**
 * Reads the configured upload ceiling so the composer can reject an oversized
 * file locally, instead of after a round trip.
 *
 * The presign route reads the SAME setting and is the actual enforcement point.
 * If an admin lowers the limit while someone has the page open, the stale
 * client value is generous rather than strict — the server still refuses. That
 * is the correct direction for the two to disagree in.
 */
export async function maxUploadMb(): Promise<number> {
  const db = createAdminClient();
  const { data } = await db
    .from('system_settings')
    .select('value')
    .eq('key', 'max_upload_size_mb')
    .maybeSingle();

  return typeof data?.value === 'number' && data.value > 0 ? data.value : FALLBACK_MAX_UPLOAD_MB;
}
