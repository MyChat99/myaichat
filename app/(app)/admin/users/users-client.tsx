'use client';

import { Search } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { setUserRole, setUserSuspended } from '@/app/(app)/admin/actions';
import { ConfirmPasswordDialog, useConfirmPassword } from '@/components/admin/confirm-password';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type AdminUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  role: 'user' | 'admin';
  suspended: boolean;
  createdAt: string;
};

export function UsersTable({
  users,
  currentUserId,
}: {
  users: AdminUser[];
  currentUserId: string;
}) {
  const confirm = useConfirmPassword();
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.displayName ?? '').toLowerCase().includes(q),
    );
  }, [users, query]);

  return (
    <>
      <div className="space-y-4">
        <div className="relative max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email or name"
            aria-label="Search users"
            className="pl-8"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm">No matching users.</p>
        ) : (
          <div className="divide-border overflow-hidden rounded-lg border">
            {filtered.map((user) => {
              const isSelf = user.id === currentUserId;

              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-3 border-b p-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {user.email ?? user.displayName ?? user.id}
                      {user.role === 'admin' ? (
                        <Badge variant="secondary" className="text-[10px]">
                          admin
                        </Badge>
                      ) : null}
                      {user.suspended ? (
                        <Badge variant="destructive" className="text-[10px]">
                          suspended
                        </Badge>
                      ) : null}
                      {isSelf ? <span className="text-muted-foreground text-xs">(you)</span> : null}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {user.displayName ?? '—'} · joined{' '}
                      {new Date(user.createdAt).toISOString().slice(0, 10)}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      // Guarded server-side too — this only hides the footgun.
                      disabled={pending || (isSelf && user.role === 'admin')}
                      onClick={() => {
                        const next = user.role === 'admin' ? 'user' : 'admin';
                        confirm.ask({
                          title:
                            next === 'admin' ? 'Promote to administrator?' : 'Remove admin access?',
                          detail:
                            next === 'admin'
                              ? `${user.email} will be able to read provider key details, change models, suspend accounts and promote other users.`
                              : `${user.email} will lose access to the admin area.`,
                          confirmLabel: next === 'admin' ? 'Promote' : 'Demote',
                          destructive: next !== 'admin',
                          onConfirm: async (password) => {
                            const result = await setUserRole(user.id, next, password);
                            if (!result.ok) return result.error;
                            toast.success(`Role changed to ${next}.`);
                            return null;
                          },
                        });
                      }}
                    >
                      {user.role === 'admin' ? 'Demote' : 'Promote'}
                    </Button>

                    <Button
                      type="button"
                      variant={user.suspended ? 'outline' : 'ghost'}
                      size="sm"
                      disabled={pending || isSelf}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            await setUserSuspended(user.id, !user.suspended);
                            toast.success(user.suspended ? 'User reactivated.' : 'User suspended.');
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : 'Could not change suspension.',
                            );
                          }
                        });
                      }}
                    >
                      {user.suspended ? 'Activate' : 'Suspend'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ConfirmPasswordDialog request={confirm.request} onClose={confirm.close} />
    </>
  );
}
