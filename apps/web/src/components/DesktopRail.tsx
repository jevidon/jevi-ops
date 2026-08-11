'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutAction } from '@/app/sign-in/actions';

// Synthesizes a Cmd+J keypress so the global TextCapturePalette opens.
// Cheaper than refactoring the palette to expose a shared open() — we
// only need to do this from two places (this button + the keyboard
// shortcut itself).
function dispatchOpenCapture() {
  const evt = new KeyboardEvent('keydown', {
    key: 'j',
    code: 'KeyJ',
    metaKey: typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform),
    ctrlKey: typeof navigator === 'undefined' || !/Mac/i.test(navigator.platform),
    bubbles: true,
  });
  window.dispatchEvent(evt);
}

function CaptureRailButton() {
  return (
    <button
      type="button"
      onClick={dispatchOpenCapture}
      className="w-full flex items-center justify-between px-6 py-3 font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors"
    >
      <span>Capture</span>
      <span className="text-ink-3">⌘J</span>
    </button>
  );
}

// Left-rail nav for desktop viewports (lg:+). Mirrors the bottom tab bar's
// six core tabs in the same order, then adds Routines and Health (which
// don't fit on mobile but have room here). Hidden on mobile entirely —
// BottomTabBar takes over there.
//
// Briefing redesign (Jun 2026): Tasks no longer has a tab. The full list
// is reachable from the Briefing's "Doing today" strip; Today stays
// active while it's open. Same applies to /inbox.
const TABS = [
  { href: '/today', label: 'Today' },
  { href: '/domains', label: 'Domains' },
  { href: '/projects', label: 'Projects' },
  { href: '/content', label: 'Content' },
  { href: '/people', label: 'People' },
  { href: '/library', label: 'Library' },
  { href: '/routines', label: 'Routines' },
  { href: '/health', label: 'Health' },
] as const;

// Routes that count as "Today sub-views" — keep Today highlighted when
// they're open so the user reads them as doorways, not destinations.
const TODAY_SUBVIEWS = ['/tasks', '/inbox'];

export function DesktopRail({
  email,
  unreadNotifications = 0,
}: {
  email?: string;
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const notifActive = pathname === '/notifications' || pathname.startsWith('/notifications/');
  return (
    <aside
      aria-label="Primary"
      className="hidden lg:flex w-[220px] shrink-0 flex-col border-r border-line bg-surface"
    >
      {/* Brand */}
      <div className="px-6 pt-7 pb-7">
        <div className="font-serif text-[20px] font-medium leading-none text-ink tracking-[-0.01em]">
          Operations
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          jevi-ops
        </div>
      </div>

      <div className="hairline mx-6" />

      {/* Tabs */}
      <nav className="flex-1 py-2">
        <ul>
          {TABS.map((tab) => {
            const isExactMatch = pathname === tab.href || pathname.startsWith(tab.href + '/');
            const isTodaySubview =
              tab.href === '/today' &&
              TODAY_SUBVIEWS.some((p) => pathname === p || pathname.startsWith(p + '/'));
            const active = isExactMatch || isTodaySubview;
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  className={`group flex items-center gap-3 px-6 py-3 font-sans text-[14px] transition-colors border-l-2 ${
                    active
                      ? 'border-ink text-ink font-semibold bg-surface-2/50'
                      : 'border-transparent text-ink-2 hover:text-ink hover:bg-surface-2/30'
                  }`}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Utility links — Capture + Search + Ask + Notifications + Settings.
          Capture is the only one that doesn't navigate — clicking it
          dispatches a Cmd+J keyboard event so the global palette opens. */}
      <div className="border-t border-line">
        <CaptureRailButton />
        <Link
          href="/search"
          className={`flex items-center justify-between px-6 py-3 font-mono text-[10px] uppercase tracking-wider border-t border-line transition-colors ${
            pathname === '/search' || pathname.startsWith('/search/') ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          <span>Search</span>
          <span className="text-ink-3">⌘K</span>
        </Link>
        <Link
          href="/chat"
          className={`block px-6 py-3 font-mono text-[10px] uppercase tracking-wider border-t border-line transition-colors ${
            pathname === '/chat' ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          Ask
        </Link>
        <Link
          href="/notifications"
          className={`flex items-center justify-between px-6 py-3 font-mono text-[10px] uppercase tracking-wider border-t border-line transition-colors ${
            notifActive ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          <span>Notifications</span>
          {unreadNotifications > 0 && (
            <span className="bg-accent text-bg font-mono text-[10px] leading-none px-1.5 py-0.5 min-w-[1.25rem] text-center">
              {unreadNotifications > 99 ? '99+' : unreadNotifications}
            </span>
          )}
        </Link>
        <Link
          href="/settings"
          className={`block px-6 py-3 font-mono text-[10px] uppercase tracking-wider border-t border-line transition-colors ${
            pathname === '/settings' ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          Settings
        </Link>
      </div>

      {/* Account footer */}
      {email && (
        <div className="border-t border-line px-6 py-4 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 truncate">
            {email}
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
