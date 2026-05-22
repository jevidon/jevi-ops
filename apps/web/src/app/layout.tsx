import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Jerad · Ops',
  description: 'Personal Operations Dashboard',
  manifest: '/manifest.webmanifest',
  applicationName: 'Jerad Ops',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
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
      <body className="font-sans bg-bg text-ink">
        <div className="mx-auto min-h-screen max-w-[480px] flex flex-col">{children}</div>
      </body>
    </html>
  );
}
