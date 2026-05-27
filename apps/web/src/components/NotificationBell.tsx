import Link from 'next/link';

// Floating notification badge for mobile. The DesktopRail already shows
// an unread count in its bottom-of-rail footer; on mobile that affordance
// is below the fold (you'd have to scroll the entire Today page to see
// it). This bell pins to the top-right of the viewport and links to
// /notifications. Mirrors the MicFAB/TextCaptureFAB positioning idiom.
//
// Hidden entirely when unread = 0 so the screen stays calm; the rail
// (or direct navigation) is still how you reach the page when nothing
// is waiting. The accent count chip matches the rail's badge styling.

export function NotificationBell({ unread }: { unread: number }) {
  if (unread <= 0) return null;

  return (
    <Link
      href="/notifications"
      aria-label={`${unread} unread notification${unread === 1 ? '' : 's'}`}
      // lg:hidden — desktop has the rail; this is just for mobile.
      className="fixed right-5 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-ink hover:bg-ink-2 transition-colors shadow-lg lg:hidden"
      style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
    >
      <BellIcon className="h-5 w-5 text-bg" />
      <span
        className="absolute -top-1 -right-1 bg-accent text-bg font-mono text-[10px] leading-none px-1.5 py-0.5 min-w-[1.25rem] text-center rounded-full"
        aria-hidden
      >
        {unread > 99 ? '99+' : unread}
      </span>
    </Link>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
