/**
 * Provider marks for the model selector.
 *
 * These are neutral lettermark badges, not the vendors' actual logos: shipping
 * a hand-drawn approximation of someone's trademark is worse than not shipping
 * it. Swap in official SVG assets here if you obtain them — nothing else needs
 * to change, and an unknown provider degrades to its initial automatically.
 */

const STYLES: Record<string, string> = {
  anthropic: 'bg-[#d97757] text-white',
  openai: 'bg-[#10a37f] text-white',
};

export function ProviderLogo({
  provider,
  className = '',
}: {
  provider: string;
  className?: string;
}) {
  const style = STYLES[provider] ?? 'bg-muted text-muted-foreground';

  return (
    <span
      aria-hidden
      title={provider}
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold uppercase ${style} ${className}`}
    >
      {provider.charAt(0)}
    </span>
  );
}
