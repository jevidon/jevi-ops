import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import '../styles/globals.css';

// Theme preference — cookie-only (`jops2.theme`: light | dark | system).
// The server stamps <html data-theme> from it before first paint, so there
// is no flash and no client-side theme script; "system" (or no cookie)
// stamps nothing and lets the prefers-color-scheme blocks in globals.css
// decide. The Settings → Appearance form writes the cookie.
const THEME_COOKIE = 'jops2.theme';
const CANVAS_LIGHT = '#F6F2EA'; // linen — tracks --bg in globals.css
const CANVAS_DARK = '#191512'; // umber — tracks --bg in globals.css

async function themePref(): Promise<'light' | 'dark' | null> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return v === 'light' || v === 'dark' ? v : null;
}

export const metadata: Metadata = {
  title: 'Almanac',
  description: 'Home, work, and life operations — a Jevi operation',
  manifest: '/manifest.webmanifest',
  applicationName: 'Almanac',
  // Icons split by purpose:
  //   - icon (any): browser tab + bookmark
  //   - apple-touch-icon: iOS Add to Home Screen
  //   - icon-mask.svg: SVG fallback for some Android launchers
  // The /app/icon.svg route stays for modern browsers; PNG entries below
  // keep older clients + iOS happy.
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    other: [{ rel: 'mask-icon', url: '/icon-mask.svg', color: '#B8442B' }],
  },
  appleWebApp: {
    capable: true,
    // 'black-translucent' lets the app content render under the iOS status
    // bar; with the v2 white canvas the bar's dark glyphs sit on white.
    // The CSS env(safe-area-inset-top) padding still applies so content
    // isn't clipped by the notch.
    statusBarStyle: 'black-translucent',
    title: 'Almanac',
  },
  formatDetection: {
    telephone: false,
  },
};

export async function generateViewport(): Promise<Viewport> {
  const pref = await themePref();
  return {
    // Browser/PWA chrome matches the body canvas. An explicit preference
    // pins one colour; "system" hands the choice to the UA via media.
    themeColor:
      pref === 'dark'
        ? CANVAS_DARK
        : pref === 'light'
          ? CANVAS_LIGHT
          : [
              { media: '(prefers-color-scheme: light)', color: CANVAS_LIGHT },
              { media: '(prefers-color-scheme: dark)', color: CANVAS_DARK },
            ],
    ...viewportBase,
  };
}

const viewportBase: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // viewport-fit=cover lets the PWA draw under the iOS home indicator,
  // which in turn makes env(safe-area-inset-bottom) report a real value
  // instead of 0. The BottomTabBar / MicFAB / TextCaptureFAB / main pb
  // all reference that inset to keep clear of the home indicator. In
  // regular Safari the inset is 0 so nothing extra renders — the cost
  // is paid only where it's needed.
  viewportFit: 'cover',
};

// Bare shell: font links + body. The tab bar + mic FAB live inside the
// (authed) route group's layout — sign-in shouldn't see them.

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pref = await themePref();
  return (
    <html lang="en" data-theme={pref ?? undefined}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body
        className="font-sans bg-bg text-ink"
        // Top safe-area padding keeps content below the iOS notch when
        // the PWA runs in standalone mode (status bar is translucent).
        // env() is a no-op in browsers without safe-area support, so
        // unconditional inline style is safe.
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* No width constraint here — each page/layout handles its own.
            Mobile (authed) pages clamp to 480px; desktop fills the viewport
            with a left rail. Sign-in centers its form. */}
        <div className="min-h-screen flex flex-col">{children}</div>
      </body>
    </html>
  );
}
