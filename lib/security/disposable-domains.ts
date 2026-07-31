/**
 * Disposable / throwaway email domains, blocked at signup.
 *
 * A static list rather than a lookup API on purpose: an API call in the signup
 * path is a third party who can take signups down, see every address that ever
 * registers, and add latency to the one action a new user is least patient
 * with. A static list is stale instead — it will miss new domains — and that is
 * the better failure. This is a spam-cost measure, not a security boundary.
 *
 * Subdomains match too (`foo.mailinator.com` is caught), which is how several
 * of these services hand out addresses.
 *
 * Note this deliberately does NOT block plus-addressing (`me+tag@gmail.com`).
 * Plus addresses are a legitimate, widely-used feature, and blocking them
 * annoys careful users while stopping nobody.
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  '0-mail.com',
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonbox.net',
  'byom.de',
  'dispostable.com',
  'discard.email',
  'disposeamail.com',
  'dropmail.me',
  'emailfake.com',
  'emailondeck.com',
  'emailtemporanea.com',
  'fakeinbox.com',
  'fakemail.net',
  'getairmail.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'harakirimail.com',
  'inboxbear.com',
  'incognitomail.com',
  'jetable.org',
  'mail-temporaire.fr',
  'mail7.io',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mailsac.com',
  'mailtemp.info',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'nowmymail.com',
  'objectmail.com',
  'pokemail.net',
  'quickinbox.com',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'tempail.com',
  'tempinbox.com',
  'tempmail.net',
  'tempmail.plus',
  'tempmailaddress.com',
  'tempmailo.com',
  'temp-mail.io',
  'temp-mail.org',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'trashmail.me',
  'trbvm.com',
  'wegwerfmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
];

const BLOCKED = new Set(DISPOSABLE_EMAIL_DOMAINS);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return false;

  // Walk the label chain so subdomains of a blocked domain are caught too.
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    if (BLOCKED.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}
