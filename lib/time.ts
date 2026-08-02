/**
 * Time helpers shared by the server and the browser.
 *
 * Deliberately NOT in the `'use client'` component that renders them: a client
 * module's exports cannot be called from the server, and the layout needs
 * `dayGroup` to bucket conversations for the first paint. Splitting the pure
 * functions out is the whole fix.
 */

export type TimeStyle = 'date' | 'dateShort' | 'dateTime' | 'time';

export const TIME_FORMATS: Record<TimeStyle, Intl.DateTimeFormatOptions> = {
  date: { weekday: 'long', day: 'numeric', month: 'long' },
  dateShort: { day: 'numeric', month: 'long' },
  dateTime: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  time: { hour: '2-digit', minute: '2-digit' },
};

/** What the server renders, and what the first client render must reproduce. */
export function formatUtc(iso: string, style: TimeStyle): string {
  return new Date(iso).toLocaleString('en-GB', { ...TIME_FORMATS[style], timeZone: 'UTC' });
}

/**
 * Which day-bucket a timestamp falls in, for the sidebar's section rules.
 *
 * Takes the boundary in the caller's zone, so "Today" means the reader's today.
 * The server calls it with UTC; the client re-runs it after hydration with the
 * local one, and a heading moves if it needs to — an evening conversation in
 * the Americas is already tomorrow in UTC, which is exactly the bug.
 */
export function dayGroup(iso: string, now: Date, utc: boolean): string {
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = utc
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    : new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = new Date(iso).getTime();

  if (at >= startOfToday) return 'Today';
  if (at >= startOfToday - day) return 'Yesterday';
  return 'Back issues';
}

/**
 * Days published, counted inclusively so the first day is No. 1.
 *
 * Calendar days rather than elapsed hours: an account made yesterday evening is
 * on issue 2 this morning, which is what a daily would say.
 */
export function issueNumber(since: string, now: string, utc: boolean): number {
  const day = 24 * 60 * 60 * 1000;
  const startOf = (d: Date) =>
    utc
      ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
      : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  return Math.max(1, Math.round((startOf(new Date(now)) - startOf(new Date(since))) / day) + 1);
}
