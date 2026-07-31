import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/security/auth';

/** `/admin` has no dashboard of its own until Phase 7 adds analytics. */
export default async function AdminIndexPage() {
  await requireAdmin();
  redirect('/admin/providers');
}
