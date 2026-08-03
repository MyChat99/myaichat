import { UserRound } from 'lucide-react';

import { attachmentUrl } from '@/lib/upload/urls';

/**
 * The reader's own portrait, wherever the app identifies them.
 *
 * Square and keylined, like everything else here. Rendered from the storage
 * key rather than a bucket URL, so it goes through the app's own download
 * route and its short-lived presigned redirect — the bucket stays private.
 */
export function AvatarMark({
  avatarKey,
  label,
  size = 22,
}: {
  avatarKey: string | null;
  label: string;
  size?: number;
}) {
  return (
    <span
      data-press="portrait"
      className="bg-muted inline-grid shrink-0 place-items-center overflow-hidden align-middle"
      style={{ width: size, height: size }}
      title={label}
    >
      {avatarKey ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={attachmentUrl(avatarKey)} alt="" aria-hidden className="size-full object-cover" />
      ) : (
        <UserRound className="text-muted-foreground size-3.5" aria-hidden />
      )}
    </span>
  );
}
