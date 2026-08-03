import type { NextConfig } from 'next';

/**
 * Security headers (Phase 7, task 6).
 *
 * CSP notes, because the obvious version breaks this app:
 *  - `'unsafe-inline'` is required for scripts because the theme resolver in
 *    app/layout.tsx is an inline <script> that must run before paint. A nonce
 *    would be stricter, but a nonce cannot be applied to that script without
 *    reintroducing the flash Phase 5 deliberately eliminated. Documented rather
 *    than quietly accepted — see PROGRESS.md Phase 7.
 *  - `'unsafe-inline'` for styles is required by the generated theme token block
 *    and by inline style attributes.
 *  - `connect-src` must include the Supabase host or the browser client cannot
 *    reach auth; R2 is included so presigned PUT uploads work once configured.
 *  - `img-src` must include the same R2 hosts, and for a reason that is easy to
 *    miss: an avatar `<img>` points at our OWN `/api/uploads/download`, which
 *    302s to a presigned R2 URL. CSP is checked against the URL the browser
 *    actually fetches, so it is checked AFTER the redirect — `'self'` is not
 *    enough, and the request is blocked with the app's own origin in the tag.
 *  - `frame-ancestors 'none'` is the modern X-Frame-Options; both are sent, as
 *    older browsers honour only the header.
 */
export function contentSecurityPolicy(dev = process.env.NODE_ENV !== 'production'): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

  /**
   * BOTH R2 hosts, and the bucket-scoped one is the one that matters.
   *
   * The SDK's endpoint is `<account>.r2.cloudflarestorage.com`, but the URL it
   * signs is virtual-hosted — `<bucket>.<account>.r2.cloudflarestorage.com`.
   * CSP host matching is exact, so allowing only the account host let every
   * browser upload fail with `Refused to connect`, while the server-side round
   * trip (which has no CSP) passed perfectly. That combination is why this
   * looked like a bucket CORS problem for as long as it did.
   *
   * Listed explicitly rather than as `*.r2.cloudflarestorage.com`: a wildcard
   * would also permit every other tenant's bucket on Cloudflare's shared
   * domain, which is a strictly larger hole than this needs.
   *
   * Used by `connect-src` (presigned PUT) and `img-src` (avatars and image
   * attachments, which arrive via a redirect to the same hosts). Adding it to
   * one and not the other is exactly the bug that hid a broken avatar in
   * production while every upload test passed.
   */
  const account = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const r2 = account
    ? [
        `https://${account}.r2.cloudflarestorage.com`,
        bucket ? `https://${bucket}.${account}.r2.cloudflarestorage.com` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  /**
   * `'unsafe-eval'` in DEVELOPMENT ONLY.
   *
   * React's development build uses `eval()` to reconstruct call stacks across
   * the server/client boundary. Blocking it does not break the app, but every
   * page logs an error and the dev overlay shows a permanent "1 Issue" — which
   * is worse than it sounds: a console that always has an error in it is a
   * console nobody reads, so the next real error goes unnoticed.
   *
   * React never uses `eval()` in production, so the shipped policy is unchanged
   * and `verify:headers` asserts that explicitly against the production build.
   */
  const scriptSrc = dev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${r2}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} ${r2}`.trim(),
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

/**
 * Everything below the CSP, kept separate so the CSP decision can be revisited
 * on its own.
 *
 *  - COOP severs the `window.opener` relationship, which is what makes
 *    cross-origin tabs able to probe this one (XS-Leaks) or navigate it away
 *    (tabnabbing). COEP is deliberately NOT set: `require-corp` would demand
 *    CORP headers on every third-party resource, and avatars served from
 *    Supabase storage do not send them.
 *  - CORP stops other origins embedding our responses as subresources.
 *  - Permissions-Policy denies the full sensor/payment surface rather than the
 *    three most-cited features; this app needs none of them, so the safe list
 *    is the empty one.
 */
const HARDENING_HEADERS = [
  // Only meaningful over HTTPS; inert on localhost.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'autoplay=()',
      'browsing-topics=()',
      'camera=()',
      'display-capture=()',
      'geolocation=()',
      'gyroscope=()',
      'interest-cohort=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
    ].join(', '),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          ...HARDENING_HEADERS,
        ],
      },
      {
        // Authenticated JSON must never be held by a shared cache. Next marks
        // dynamic routes private already; this is the belt-and-braces version
        // for proxies that read only the header.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
