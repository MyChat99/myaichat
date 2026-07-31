import type { Metadata } from 'next';

import { ProfileForm } from '@/components/profile/profile-form';
import { createClient } from '@/lib/db/server';
import { isStorageConfigured } from '@/lib/r2/storage';
import { requireUser } from '@/lib/security/auth';

export const metadata: Metadata = { title: 'Profile · myaichat' };

export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Profile</h1>
          <p className="text-muted-foreground mt-1 text-sm">{user.email}</p>
        </header>

        <ProfileForm
          initialDisplayName={profile?.display_name ?? ''}
          initialAvatarKey={profile?.avatar_url ?? null}
          storageEnabled={isStorageConfigured()}
        />
      </div>
    </div>
  );
}
