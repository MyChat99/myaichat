import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { Toaster } from '@/components/ui/sonner';
import { themeCss, rootFontSize } from '@/lib/theme/css';
import { accentToHex, loadAppearance } from '@/lib/theme/preferences';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://myaichat-production.up.railway.app';

/**
 * `metadataBase` matters more than it looks: without it, Next emits RELATIVE
 * og:image URLs, and every crawler that reads them resolves nothing. The
 * generated card in opengraph-image.tsx would silently never appear.
 */
export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'myaichat',
    // Page-level titles fill the slot; the suffix is not repeated by hand.
    template: '%s · myaichat',
  },
  description: 'One chat interface for every model — streaming chat across providers.',
  applicationName: 'myaichat',
  openGraph: {
    type: 'website',
    siteName: 'myaichat',
    title: 'myaichat',
    description: 'One chat interface for every model — streaming chat across providers.',
    url: APP_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'myaichat',
    description: 'One chat interface for every model — streaming chat across providers.',
  },
  // A private chat app has nothing to gain from being indexed, and conversation
  // URLs are 404-on-RLS rather than secret — keeping crawlers out entirely is
  // the conservative default.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Matches the badge colour, so mobile browser chrome does not clash with it.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0f' },
  ],
  width: 'device-width',
  initialScale: 1,
  // NOT `maximumScale: 1` — locking zoom is an accessibility failure, and iOS
  // Safari ignores it anyway.
  viewportFit: 'cover',
};

/**
 * Runs before first paint, so `system` mode never flashes.
 *
 * Explicit light/dark is already correct in the server-rendered HTML; this
 * only resolves `system` against the OS setting, and keeps following it if the
 * user changes it mid-session.
 *
 * Deliberately tiny and dependency-free — it is inlined and blocks paint.
 */
const THEME_SCRIPT = `(function(){try{
var m=document.documentElement.dataset.themeMode;
if(m!=='system')return;
var q=window.matchMedia('(prefers-color-scheme: dark)');
var a=function(e){document.documentElement.classList.toggle('dark',e.matches)};
a(q);
q.addEventListener('change',a);
}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const appearance = await loadAppearance();
  const accentHex = accentToHex(appearance.accentColor);

  // For an explicit choice the class is correct in the initial HTML, so there
  // is nothing to correct after hydration. `system` starts light and is
  // resolved by THEME_SCRIPT before paint.
  const darkClass = appearance.theme === 'dark' ? 'dark' : '';

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${darkClass}`}
      data-theme-mode={appearance.theme}
      data-theme={appearance.presetTheme}
      data-bubble={appearance.bubbleStyle}
      data-font-size={appearance.fontSize}
      style={{ fontSize: `${rootFontSize(appearance.fontSize)}px` }}
      suppressHydrationWarning
    >
      <head>
        {/* Both modes are emitted, so switching is a class toggle rather than
            a re-render or a request. */}
        {/* Generated from typed tokens in lib/theme, never from user-supplied
            strings — the accent is validated as #rrggbb before it gets here. */}
        <style
          id="theme-tokens"
          dangerouslySetInnerHTML={{ __html: themeCss(appearance.presetTheme, accentHex) }}
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
