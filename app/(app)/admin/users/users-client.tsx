'use client';

import { Check, Copy, Search } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { resetUserPassword, setUserRole, setUserSuspended } from '@/app/(app)/admin/actions';
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
  /**
   * The issued password, shown once.
   *
   * Held here rather than on the row so the reveal survives the list
   * re-rendering after `revalidatePath` — which it does immediately, and which
   * would otherwise wipe the only copy of a credential that exists nowhere
   * else.
   */
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
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
      {/*
        The one and only sighting of an issued password.
        Nothing stores it: the database holds a hash, the audit log records the
        email and not the credential, and the server returned it once. Dismissing
        this panel is the last chance to have it.
      */}
      {issued ? (
        <section data-press="create-user">
          <p data-press="create-user-title">New password issued</p>
          <p data-press="create-user-made">{issued.email}</p>
          <p data-press="create-user-once">
            Shown once. It is stored nowhere — not in the database, not in the audit log. Copy it
            now and hand it over directly; it is not emailed.
          </p>
          <div data-press="create-user-secret">
            <code>{issued.password}</code>
            <button
              type="button"
              aria-label="Copy password"
              onClick={() => {
                void navigator.clipboard.writeText(issued.password).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </button>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setIssued(null)}>
            Done
          </Button>
        </section>
      ) : null}

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

                  {/*
                    Wraps, and no longer `shrink-0`. A third action pushed this
                    row 48px off the side at 768px — `verify:pages` measures
                    exactly that, and a control that is off the screen edge is
                    not a control. Wrapping is the right answer rather than
                    hiding one behind a menu: all three are one click at every
                    width, they just occupy two lines on a narrow one.
                  */}
                  <div className="flex flex-wrap justify-end gap-2">
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
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        confirm.ask({
                          title: 'Issue a new password?',
                          detail: `${user.email} will be signed out of nothing — their existing sessions continue — but their old password stops working immediately. The new one is shown once, here, and is not emailed.`,
                          confirmLabel: 'Issue password',
                          onConfirm: async (password) => {
                            const result = await resetUserPassword(user.id, password);
                            if (!result.ok) return result.error;
                            setIssued({ email: result.email, password: result.password });
                            return null;
                          },
                        });
                      }}
                    >
                      Reset
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
