/**
 * Money formatting, shared by the server and the browser.
 *
 * Not in `lib/db/costs.ts`, which is `server-only` — a client component cannot
 * import from there, and having two formatters would eventually mean a cost
 * rendered two different ways on the same screen.
 *
 * Sub-cent amounts get four decimal places: most single answers cost less than
 * a cent, and "$0.00" beside every reply would make the feature pointless.
 */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
