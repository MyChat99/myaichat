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
 *  - `frame-ancestors 'none'` is the modern X-Frame-Options; both are sent, as
 *    older browsers honour only the header.
 */
function contentSecurityPolicy(): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const r2 = process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : '';

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} ${r2}`.trim(),
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          // Only meaningful over HTTPS; inert on localhost.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
