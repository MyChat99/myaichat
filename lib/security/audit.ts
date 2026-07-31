import 'server-only';

import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/db/admin';

/**
 * Audit logging for admin mutations.
 *
 * Writes through the admin client because `audit_logs` has no client-facing
 * insert policy — audit rows must not be forgeable from the browser (Phase 1,
 * migration 20260730120003).
 *
 * CSRF is handled by the framework: every admin mutation is a Next.js Server
 * Action, and those verify the Origin header against the host before the
 * action body runs. There is no admin mutation reachable by a plain form POST.
 */

export type AuditAction =
  | 'provider.key_set'
  | 'provider.key_deleted'
  | 'provider.toggled'
  | 'model.created'
  | 'model.updated'
  | 'model.deleted'
  | 'user.role_changed'
  | 'user.suspension_changed'
  | 'settings.updated'
  // Exporting the audit log is itself audited. Not circular: pulling a full
  // record of every administrative action is exactly what a later reviewer
  // wants to see, and an export that leaves no trace is a gap in the thing it
  // is exporting.
  | 'audit.exported'
  | 'upload.presigned';

type AuditEntry = {
  actorId: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

/** Best-effort client IP from the proxy headers Railway/Vercel set. */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return h.get('x-real-ip');
}

/**
 * Records an admin action. Never throws: a failed audit write must not roll
 * back or mask the mutation the admin actually asked for — but it is logged
 * loudly, because a silent gap in the audit trail is its own problem.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    const ip = await clientIp();
    const admin = createAdminClient();

    const { error } = await admin.from('audit_logs').insert({
      actor_id: entry.actorId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      // Callers must never put secrets in here — see the redaction note below.
      metadata: (entry.metadata ?? {}) as never,
      ip,
    });

    if (error) console.error('[audit] insert failed:', entry.action, error.message);
  } catch (err) {
    console.error('[audit] insert threw:', entry.action, err);
  }
}

/**
 * Strips anything key-shaped from metadata before it is logged.
 *
 * The audit trail is read by admins in Phase 7 and exported; a provider key
 * that leaked into it would be as exposed as one in plaintext in the database.
 * Callers should pass only identifiers and last-4s, but this is the backstop.
 */
export function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE = /^(api_?key|secret|token|password|encrypted_api_key)$/i;

  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      SENSITIVE.test(key) ? '[redacted]' : value,
    ]),
  );
}
