import { cn } from '@/lib/utils';

/**
 * Placeholder block for content that is still loading.
 *
 * `animate-pulse` is neutralised under prefers-reduced-motion by the rule in
 * globals.css, which is why this is a plain element rather than a Framer
 * component — the CSS path already covers it.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  );
}

export { Skeleton };
