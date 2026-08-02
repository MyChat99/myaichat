'use client';

import { useHydrated } from '@/lib/hooks/use-hydrated';
import { formatUtc, TIME_FORMATS, type TimeStyle } from '@/lib/time';

/**
 * A timestamp in the reader's own time zone.
 *
 * The server has no idea where the reader is, so anything it formats is in UTC
 * — which showed the wrong DAY for anyone far enough west, and silently: a
 * conversation started at 8pm in New York is already tomorrow in UTC, so it
 * appeared under the wrong section heading and carried the wrong date.
 *
 * Formatting cannot simply move to the client, because the server still has to
 * render something and the two must agree at hydration or React throws. So:
 * the server's UTC rendering is what ships in the HTML and what the first
 * client render reproduces exactly; the local rendering replaces it on the
 * commit after. The value can therefore change once, shortly after load, by up
 * to a day — which is the honest cost of not knowing the reader's zone until
 * their browser tells us.
 *
 * `<time dateTime>` carries the machine-readable instant regardless, so the
 * value is unambiguous to anything that parses rather than reads.
 */

export function LocalTime({
  iso,
  style = 'date',
  className,
  uppercase = false,
}: {
  iso: string;
  style?: TimeStyle;
  className?: string;
  /** The masthead sets its own case; this keeps the two in step. */
  uppercase?: boolean;
}) {
  const hydrated = useHydrated();
  const value = hydrated
    ? new Date(iso).toLocaleString('en-GB', TIME_FORMATS[style])
    : formatUtc(iso, style);

  return (
    <time dateTime={iso} className={className}>
      {uppercase ? value.toUpperCase() : value}
    </time>
  );
}

