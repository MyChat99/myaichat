'use client';

import { Check, Loader2, Upload, X } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  removeAvatar,
  setAvatar,
  setPresetAvatar,
  updateDisplayName,
} from '@/app/(app)/profile/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { uploadFile } from '@/lib/upload/client';
import { PRESET_NAMES, PressMark } from '@/components/ui/press-mark';
import { PRESET_COUNT, avatarSource, presetRef } from '@/lib/upload/urls';

export function ProfileForm({
  initialDisplayName,
  initialAvatarKey,
  storageEnabled,
  userId,
}: {
  initialDisplayName: string;
  initialAvatarKey: string | null;
  storageEnabled: boolean;
  /** Seeds the mark shown to someone who has chosen nothing. */
  userId: string;
}) {
  const [name, setName] = useState(initialDisplayName);
  const [avatarKey, setAvatarKey] = useState(initialAvatarKey);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  /*
   * One source of truth for what is currently shown, resolved by the same
   * function the masthead and tab rail use. The preview cannot drift from the
   * rest of the app because it is not a second implementation of the rule.
   */
  const source = avatarSource(avatarKey, userId);

  function chooseMark(index: number) {
    startTransition(async () => {
      try {
        await setPresetAvatar(index);
        // Optimistic, but written in the same form the server stored, so a
        // later re-render agrees with what is on screen now.
        setAvatarKey(presetRef(index));
        toast.success(`${PRESET_NAMES[index]} set.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not set that portrait.');
      }
    });
  }

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
            {source.kind === 'upload' ? (
              // Served through our route, never the bucket — the URL is a
              // short-lived presigned redirect.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={source.url} alt="Your avatar" className="size-full object-cover" />
            ) : (
              <PressMark index={source.index} size={64} />
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
                {source.kind === 'upload' ? 'Replace' : 'Upload a photo'}
              </Button>

              {/* Only for a photo. "Remove" a generated mark would mean
                  reverting to the seeded one, which is a mark either way —
                  an action whose result looks identical to not taking it. */}
              {source.kind === 'upload' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await removeAvatar();
                      setAvatarKey(null);
                      toast.success('Photo removed.');
                    })
                  }
                >
                  <X className="mr-1.5 size-3.5" />
                  Remove photo
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

        {/*
          The marks. Presented as a real choice beside the upload, not as a
          fallback for people who failed to upload something — which is why they
          are named. "Overprint" and "Quoin" are things on a press; a portrait
          that is a printer's mark belongs to this application in a way a stock
          photograph never would.

          A radiogroup rather than buttons: these are one exclusive choice, and
          arrow-key navigation between options is what a screen-reader user will
          expect from that role.
        */}
        <div role="radiogroup" aria-label="Generated portraits" data-press="mark-gallery">
          {Array.from({ length: PRESET_COUNT }, (_, index) => {
            const active = source.kind === 'preset' && source.index === index;
            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={PRESET_NAMES[index]}
                disabled={pending}
                onClick={() => chooseMark(index)}
                data-press="mark-option"
                data-active={active ? 'true' : undefined}
              >
                <PressMark index={index} size={44} />
                <span data-press="mark-name">{PRESET_NAMES[index]}</span>
                {active ? <Check data-press="mark-check" aria-hidden /> : null}
              </button>
            );
          })}
        </div>

        <p className="text-muted-foreground text-xs">
          {source.kind === 'upload'
            ? 'Choosing a mark replaces your photo, and deletes it from storage.'
            : 'Pick a mark, or upload a photo to replace it.'}
        </p>

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
