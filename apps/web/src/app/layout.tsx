import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Jerad · Ops',
  description: 'Personal Operations Dashboard',
  manifest: '/manifest.webmanifest',
  applicationName: 'Jerad Ops',
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
    // bar — together with our cream theme_color the bar disappears into
    // the warm-linen body. 'default' (was) gave a grey bar that fought
    // the brand. The CSS env(safe-area-inset-top) padding still applies
    // so content doesn't get clipped by the notch.
    statusBarStyle: 'black-translucent',
    title: 'Jerad Ops',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#F6F2EA',
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
