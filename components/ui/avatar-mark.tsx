import { PressMark } from '@/components/ui/press-mark';
import { avatarSource } from '@/lib/upload/urls';

/**
 * The reader's own portrait, wherever the app identifies them.
 *
 * Square and keylined, like everything else here. An uploaded photo is rendered
 * from the storage key rather than a bucket URL, so it goes through the app's
 * own download route and its short-lived presigned redirect — the bucket stays
 * private.
 *
 * ## Three states, resolved in ONE place
 *
 * A portrait is an uploaded object, a chosen mark, or neither — and "neither"
 * still draws a mark, seeded from the user id. `avatarSource()` decides which,
 * and it decides here rather than at each call site, because there are two call
 * sites and they are easy to miss: the masthead in `app/(app)/layout.tsx` and
 * the tab rail in `components/chat/section-tabs.tsx`, with the masthead hidden
 * on every chat page. Fixing one and not the other already shipped once.
 *
 * The generic person glyph is gone. It was a placeholder for something that
 * might never arrive; a seeded mark is a real portrait for someone who has not
 * chosen one.
 */
export function AvatarMark({
  avatarKey,
  label,
  seed,
  size = 22,
}: {
  /** `profiles.avatar_url`: a storage key, a `preset:N` reference, or null. */
  avatarKey: string | null;
  label: string;
  /**
   * What seeds the default mark — the user id. Falls back to the label so a
   * caller that has no id still gets a stable mark rather than always index 0,
   * which would make every such user identical.
   */
  seed?: string;
  size?: number;
}) {
  const source = avatarSource(avatarKey, seed ?? label);

  return (
    <span
      data-press="portrait"
      className="bg-muted inline-grid shrink-0 place-items-center overflow-hidden align-middle"
      style={{ width: size, height: size }}
      title={label}
    >
      {source.kind === 'upload' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source.url} alt="" aria-hidden className="size-full object-cover" />
      ) : (
        <PressMark index={source.index} size={size} />
      )}
    </span>
  );
}
