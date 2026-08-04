import { createAdminClient } from '@/lib/db/admin';
import { requireAdmin } from '@/lib/security/auth';

import { CreateUser } from './create-user';
import { UsersTable, type AdminUser } from './users-client';

export default async function UsersPage() {
  const admin = await requireAdmin();

  const db = createAdminClient();

  // Emails live in auth.users, roles in public.profiles — join them here rather
  // than duplicating the address into profiles.
  const [{ data: profiles }, { data: authUsers }] = await Promise.all([
    db.from('profiles').select('id, display_name, role, suspended, created_at'),
    db.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? null]));

  const users: AdminUser[] = (profiles ?? [])
    .map((p) => ({
      id: p.id,
      email: emailById.get(p.id) ?? null,
      displayName: p.display_name,
      role: p.role,
      suspended: p.suspended,
      createdAt: p.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Suspended users keep their history and can still sign in, but cannot send messages —
          enforced by row-level security, not just the UI.
        </p>
      </header>

      <CreateUser />

      <UsersTable users={users} currentUserId={admin.id} />
    </div>
  );
}
