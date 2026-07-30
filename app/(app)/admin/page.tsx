import type { Metadata } from 'next';

import { requireAdmin } from '@/lib/security/auth';

export const metadata: Metadata = { title: 'Admin · myaichat' };

/**
 * Placeholder. The real panel is Phase 4 — what matters here is that the
 * role gate works, which the Phase 1 acceptance criteria check.
 */
export default async function AdminPage() {
  const admin = await requireAdmin();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Signed in as {admin.email} with the admin role. Provider keys, model management, and user
        administration land in Phase 4.
      </p>
    </div>
  );
}
