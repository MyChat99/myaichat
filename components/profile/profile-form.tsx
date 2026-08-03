'use client';

import { Loader2, Upload, UserRound, X } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { removeAvatar, setAvatar, updateDisplayName } from '@/app/(app)/profile/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { uploadFile } from '@/lib/upload/client';
import { attachmentUrl } from '@/lib/upload/urls';

export function ProfileForm({
  initialDisplayName,
  initialAvatarKey,
  storageEnabled,
}: {
  initialDisplayName: string;
  initialAvatarKey: string | null;
  storageEnabled: boolean;
}) {
  const [name, setName] = useState(initialDisplayName);
  const [avatarKey, setAvatarKey] = useState(initialAvatarKey);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  async function onPickAvatar(file: File) {
    setUploading(true);
    try {
      const result = await uploadFile(file, 'avatar');
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      await setAvatar(result.key);
      setAvatarKey(result.key);
      toast.success('Avatar updated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the avatar.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Avatar</h2>

        <div className="flex items-center gap-4">
          {/* Square, hard-bordered, offset. Circles belong to the soft UI this
              design replaced — a printed portrait is a block on the page. */}
          <div
            className="bg-muted flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full"
            data-press="portrait"
          >
            {avatarKey ? (
              // Served through our route, never the bucket — the URL is a
              // short-lived presigned redirect.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={attachmentUrl(avatarKey)}
                alt="Your avatar"
                className="size-full object-cover"
              />
            ) : (
              <UserRound className="text-muted-foreground size-7" aria-hidden />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!storageEnabled || uploading || pending}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 size-3.5" />
                )}
                {avatarKey ? 'Replace' : 'Upload'}
              </Button>

              {avatarKey ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await removeAvatar();
                      setAvatarKey(null);
                      toast.success('Avatar removed.');
                    })
                  }
                >
                  <X className="mr-1.5 size-3.5" />
                  Remove
                </Button>
              ) : null}
            </div>

            <p className="text-muted-foreground text-xs">
              {storageEnabled
                ? 'PNG, JPEG, WebP or GIF.'
                : 'File storage is not configured on this deployment.'}
            </p>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPickAvatar(file);
            e.target.value = '';
          }}
        />
      </section>

      <section className="max-w-sm space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <Button
          type="button"
          disabled={pending || !name.trim() || name === initialDisplayName}
          onClick={() =>
            startTransition(async () => {
              try {
                await updateDisplayName(name);
                toast.success('Name updated.');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not update your name.');
              }
            })
          }
        >
          Save name
        </Button>
      </section>
    </div>
  );
}
