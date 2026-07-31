import type { Metadata } from 'next';

import { ProfileForm } from '@/components/profile/profile-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/db/server';
import { isStorageConfigured } from '@/lib/r2/storage';
import { requireUser } from '@/lib/security/auth';

export const metadata: Metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url, created_at')
    .eq('id', user.id)
    .maybeSingle();

  // Fixed locale and UTC: the server renders this, and letting it follow the
  // server's locale would make the markup differ from what the browser would
  // produce and trip a hydration mismatch.
  const joined = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Profile</h1>
          <p className="text-muted-foreground mt-1 text-sm">{user.email}</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-xs">Email</dt>
                <dd className="mt-0.5 break-all">{user.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Role</dt>
                <dd className="mt-0.5">
                  <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                    {user.role}
                  </Badge>
                </dd>
              </div>
              {joined ? (
                <div>
                  <dt className="text-muted-foreground text-xs">Member since</dt>
                  <dd className="mt-0.5">{joined}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground text-xs">Status</dt>
                <dd className="mt-0.5">{user.suspended ? 'Suspended' : 'Active'}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <ProfileForm
          initialDisplayName={profile?.display_name ?? ''}
          initialAvatarKey={profile?.avatar_url ?? null}
          storageEnabled={isStorageConfigured()}
        />
      </div>
    </div>
  );
}
