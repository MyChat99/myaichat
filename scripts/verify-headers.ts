/**
 * Asserts the security headers the app promises to send.
 *
 * Reads `next.config.ts` directly rather than curling a running server: the
 * config is the single source of truth, this needs no credentials and no boot,
 * and so it can run on every pull request. The tradeoff is that it proves the
 * config, not the deployment — a proxy in front of Railway stripping a header
 * would not be caught here. That gap is checked by hand against the live domain
 * and recorded in PROGRESS.md.
 *
 * The CSP assertions below are deliberately shaped as "must contain", not "must
 * equal". `script-src 'unsafe-inline'` is a known, documented exception for the
 * pre-paint theme script and is the owner's call to revisit; this script's job
 * is to stop the *other* directives silently regressing.
 *
 *   npm run verify:headers
 */
import nextConfig, { contentSecurityPolicy } from '../next.config';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = '') {
  checks++;
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

async function main() {
  console.log('Security headers — asserted against next.config.ts\n');

  if (typeof nextConfig.headers !== 'function') {
    console.error('next.config.ts exports no headers() function.');
    process.exit(1);
  }

  const groups = await nextConfig.headers();

  function headersFor(path: string): Map<string, string> {
    // Next matches every rule whose source pattern covers the path, and later
    // rules win on conflict — so build the map in order.
    const map = new Map<string, string>();
    for (const group of groups) {
      const pattern = new RegExp(`^${group.source.replace(/:path\*/, '.*')}$`);
      if (!pattern.test(path)) continue;
      for (const h of group.headers) map.set(h.key.toLowerCase(), h.value);
    }
    return map;
  }

  const page = headersFor('/settings');

  console.log('Page responses');

  const required: [string, string][] = [
    ['x-frame-options', 'DENY'],
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['cross-origin-opener-policy', 'same-origin'],
    ['cross-origin-resource-policy', 'same-origin'],
    ['x-dns-prefetch-control', 'off'],
  ];

  for (const [key, value] of required) {
    check(`${key}: ${value}`, page.get(key) === value, `got ${page.get(key) ?? '(absent)'}`);
  }

  const hsts = page.get('strict-transport-security') ?? '';
  const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
  // Six months is the floor for preload-list eligibility.
  check('strict-transport-security: max-age >= 15552000', maxAge >= 15_552_000, hsts);
  check('strict-transport-security: includeSubDomains', hsts.includes('includeSubDomains'), hsts);

  const permissions = page.get('permissions-policy') ?? '';
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
    check(`permissions-policy denies ${feature}`, permissions.includes(`${feature}=()`));
  }

  console.log('\nContent-Security-Policy');

  const csp = page.get('content-security-policy') ?? '';
  const directives = new Map(
    csp.split(';').map((part) => {
      const [name, ...rest] = part.trim().split(/\s+/);
      return [name, rest.join(' ')];
    }),
  );

  check("default-src 'self'", directives.get('default-src') === "'self'");
  check("frame-ancestors 'none'", directives.get('frame-ancestors') === "'none'");
  check("object-src 'none'", directives.get('object-src') === "'none'");
  check("base-uri 'self'", directives.get('base-uri') === "'self'");
  check("form-action 'self'", directives.get('form-action') === "'self'");

  // ⚠️ Asserted against the PRODUCTION policy specifically, not against
  // whatever this process happens to be running as. Development deliberately
  // allows 'unsafe-eval' for React's dev-only call-stack reconstruction; if
  // this check simply read the ambient policy it would pass in production and
  // silently stop testing anything the moment it ran under NODE_ENV=development.
  const prod = new Map(
    contentSecurityPolicy(false)
      .split(';')
      .map((part) => {
        const [name, ...rest] = part.trim().split(/\s+/);
        return [name, rest.join(' ')];
      }),
  );

  check(
    "production script-src does not allow 'unsafe-eval'",
    !(prod.get('script-src') ?? '').includes('unsafe-eval'),
    prod.get('script-src'),
  );
  check(
    "development script-src DOES allow 'unsafe-eval' (React dev tooling)",
    (contentSecurityPolicy(true).match(/script-src[^;]*/)?.[0] ?? '').includes('unsafe-eval'),
  );
  check(
    'script-src is not a wildcard',
    !(directives.get('script-src') ?? '').includes('*'),
    directives.get('script-src'),
  );
  check(
    "connect-src does not allow '*'",
    !(directives.get('connect-src') ?? '').split(/\s+/).includes('*'),
    directives.get('connect-src'),
  );

  if ((directives.get('script-src') ?? '').includes("'unsafe-inline'")) {
    console.log(
      "\n  note  script-src still carries 'unsafe-inline' for the pre-paint theme\n" +
        '        script. Known and documented (ISSUE log / PROGRESS.md Phase 7);\n' +
        '        not treated as a failure here.',
    );
  }

  console.log('\nAPI responses');

  const api = headersFor('/api/chat');
  const cache = api.get('cache-control') ?? '';
  check('api: cache-control no-store', cache.includes('no-store'), cache || '(absent)');
  // API routes must still inherit the page hardening, not replace it.
  check('api: inherits x-frame-options', api.get('x-frame-options') === 'DENY');
  check('api: inherits content-security-policy', Boolean(api.get('content-security-policy')));

  console.log(
    failures === 0
      ? `\nAll ${checks} header checks passed.`
      : `\n${failures} of ${checks} header checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
