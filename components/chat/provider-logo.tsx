import { PROVIDER_BRAND } from '@/lib/theme/brand';

/**
 * Provider marks for the model selector.
 *
 * These are neutral lettermark badges, not the vendors' actual logos: shipping
 * a hand-drawn approximation of someone's trademark is worse than not shipping
 * it. Swap in official SVG assets here if you obtain them — nothing else needs
 * to change, and an unknown provider degrades to its initial automatically.
 */

export function ProviderLogo({
  provider,
  className = '',
}: {
  provider: string;
  className?: string;
}) {
  // Brand colours live in lib/theme/brand.ts — fixed values, not theme tokens,
  // so a vendor's mark looks the same in every theme. An unknown provider falls
  // back to theme tokens and needs no entry.
  const brand = PROVIDER_BRAND[provider];

  return (
    <span
      aria-hidden
      title={provider}
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold uppercase ${
        brand ? '' : 'bg-muted text-muted-foreground'
      } ${className}`}
      style={brand ? { backgroundColor: brand.background, color: brand.foreground } : undefined}
    >
      {provider.charAt(0)}
    </span>
  );
}
