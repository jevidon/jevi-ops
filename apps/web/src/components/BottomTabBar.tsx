'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutAction } from '@/app/sign-in/actions';
import { Icon, type IconName } from './Icon';
import { BottomSheet } from './BottomSheet';

// Mobile primary nav, five positions: Work · Library · [Almanac logo] ·
// Search · More. The logo (center, no label) is the home link — the Briefing
// lives at `/`. Everything else the desktop IconRail exposes — Content,
// People, Tasks, Companies, Routines, Health, Ask, Attention, Notifications,
// Settings, sign-out — lives behind "More", which opens a bottom sheet
// instead of cramming the bar.
//
// The keyboard shortcuts (⌘K search, ⌘J capture) still work but have no
// mobile chrome, hence Capture also appearing in the More sheet flows.

type TabIcon = (props: { className?: string }) => React.ReactElement;

const LEFT_TABS: Array<{ href: string; label: string; Icon: TabIcon }> = [
  // Work (Addendum 08) replaces the Domains + Projects tabs.
  { href: '/work', label: 'Work', Icon: ProjectsIcon },
  { href: '/library', label: 'Library', Icon: LibraryIcon },
];
const RIGHT_TABS: Array<{ href: string; label: string; Icon: TabIcon }> = [
  { href: '/search', label: 'Search', Icon: SearchIcon },
];

// /inbox stays a home doorway (keeps the logo highlighted). /tasks is reached
// via More, so it highlights More.
const HOME_SUBVIEWS = ['/inbox'];

interface MoreItem {
  href: string;
  label: string;
  icon: IconName;
  flag?: 'health' | 'routines';
  badge?: number;
  badgeAccent?: boolean;
}

export function BottomTabBar({
  email,
  unreadNotifications = 0,
  attentionActive = 0,
  healthEnabled = false,
  routinesEnabled = true,
}: {
  email?: string;
  unreadNotifications?: number;
  attentionActive?: number;
  healthEnabled?: boolean;
  routinesEnabled?: boolean;
} = {}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isTabActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const homeActive =
    pathname === '/' ||
    HOME_SUBVIEWS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  // "More" owns every route that isn't a tab or a home doorway, so it
  // highlights on Content, People, Tasks, Companies, Settings, Ask, etc.
  const moreActive =
    !homeActive && ![...LEFT_TABS, ...RIGHT_TABS].some((t) => isTabActive(t.href));

  const moreItems: MoreItem[] = ([
    { href: '/content', label: 'Content', icon: 'content' },
    { href: '/people', label: 'People', icon: 'people' },
    { href: '/tasks', label: 'Tasks', icon: 'tasks' },
    { href: '/companies', label: 'Companies', icon: 'companies' },
    { href: '/routines', label: 'Routines', icon: 'routines', flag: 'routines' },
    { href: '/health', label: 'Health', icon: 'health', flag: 'health' },
    { href: '/chat', label: 'Ask', icon: 'ask' },
    {
      href: '/attention', label: 'Attention', icon: 'flag',
      badge: attentionActive > 0 ? attentionActive : undefined,
    },
    {
      href: '/notifications', label: 'Notifications', icon: 'bell',
      badge: unreadNotifications > 0 ? unreadNotifications : undefined, badgeAccent: true,
    },
    { href: '/settings', label: 'Settings', icon: 'gear' },
  ] as MoreItem[]).filter(
    (it) => (it.flag !== 'health' || healthEnabled) && (it.flag !== 'routines' || routinesEnabled),
  );

  return (
    <>
      <nav
        aria-label="Primary"
        // Full-bleed (inset-x-0), independent of any content max-width, so the
        // bar spans edge to edge on a wider-than-typical viewport (foldable
        // cover screen) instead of floating inset. z-40 puts it above sticky
        // page headers (z-10/20/30) so scrolling content can't paint over it;
        // opaque bg (was /95 + blur) so nothing shows through underneath.
        className="fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-line lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Variant B (tab-bar study): row capped + centered so the five
            targets sit in thumb range instead of spanning the screen. */}
        <ul className="mx-auto max-w-[352px] flex justify-around items-stretch h-[58px]">
          {LEFT_TABS.map((tab) => (
            <TabItem key={tab.href} {...tab} active={isTabActive(tab.href)} />
          ))}

          {/* Center: the Almanac mark, no label — the home link. */}
          <li className="flex-1">
            <Link
              href="/"
              aria-label="Home"
              aria-current={homeActive ? 'page' : undefined}
              className="flex h-full flex-col items-center justify-center"
            >
              {/* Docked float: the mark rises out of the bar, ringed in the
                  linen canvas so it reads as sitting ON the page. Content
                  scrolls under the overhang — deliberate. */}
              <span
                className={`grid place-items-center w-[54px] h-[54px] -mt-[18px] rounded-[15px] bg-accent border-[3px] border-bg shadow-[0_4px_14px_-6px_rgba(18,16,14,0.4)] transition-opacity ${
                  homeActive ? 'opacity-100' : 'opacity-80'
                }`}
              >
                <svg viewBox="0 0 32 32" className="w-[36px] h-[36px] fill-bg" aria-hidden>
                  <polygon points="16,2.8 17.99,11.2 25.33,6.67 20.8,14.01 29.2,16 20.8,17.99 25.33,25.33 17.99,20.8 16,29.2 14.01,20.8 6.67,25.33 11.2,17.99 2.8,16 11.2,14.01 6.67,6.67 14.01,11.2" />
                </svg>
              </span>
            </Link>
          </li>

          {RIGHT_TABS.map((tab) => (
            <TabItem key={tab.href} {...tab} active={isTabActive(tab.href)} />
          ))}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`flex h-full w-full flex-col items-center justify-center gap-0.5 transition-colors ${
                moreActive ? 'text-ink' : 'text-ink-3'
              }`}
            >
              <MoreIcon className="h-[22px] w-[22px]" />
              <span
                className={`font-sans text-[11px] leading-none ${
                  moreActive ? 'font-semibold' : 'font-medium'
                }`}
              >
                More
              </span>
            </button>
          </li>
        </ul>
      </nav>

      <BottomSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="More"
        footer={
          email ? (
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3 truncate">
                {email}
              </span>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-accent transition-colors shrink-0"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : undefined
        }
      >
        <ul className="px-2 py-1.5">
          {moreItems.map((it) => {
            const active = pathname === it.href || pathname.startsWith(it.href + '/');
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${
                    active ? 'bg-ink text-bg' : 'text-ink hover:bg-[color:rgb(var(--ink)_/_0.045)]'
                  }`}
                >
                  <span className="relative shrink-0 w-[22px] grid place-items-center">
                    <Icon name={it.icon} size={20} />
                  </span>
                  <span className="flex-1 font-sans text-[15px]">{it.label}</span>
                  {it.badge != null && (
                    <span
                      className={`font-mono text-[10px] leading-none px-1.5 py-[3px] rounded-full ${
                        it.badgeAccent ? 'bg-accent text-bg' : 'bg-ink text-bg'
                      } ${active ? 'bg-bg/20' : ''}`}
                    >
                      {it.badge > 99 ? '99+' : it.badge}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </>
  );
}

function TabItem({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: TabIcon;
  active: boolean;
}) {
  return (
    <li className="flex-1">
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex h-full flex-col items-center justify-center gap-0.5 transition-colors ${
          active ? 'text-ink' : 'text-ink-3'
        }`}
      >
        <Icon className="h-[22px] w-[22px]" />
        <span
          className={`font-sans text-[11px] leading-none ${
            active ? 'font-semibold' : 'font-medium'
          }`}
        >
          {label}
        </span>
      </Link>
    </li>
  );
}

function MoreIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────
// Thin-stroke linear SVGs in the design's editorial style. 22×22, stroke
// 1.5. Active state inherits text color from the parent <Link> via
// currentColor on both stroke and fill — no per-icon active variant.

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 21 21" />
    </svg>
  );
}

function DomainsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" />
      <rect x="13.5" y="3.5" width="7" height="7" />
      <rect x="3.5" y="13.5" width="7" height="7" />
      <rect x="13.5" y="13.5" width="7" height="7" />
    </svg>
  );
}

function ProjectsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* gantt-ish: three horizontal bars, offset like a project plan */}
      <rect x="3" y="5" width="13" height="3" rx="0.5" />
      <rect x="7" y="10.5" width="14" height="3" rx="0.5" />
      <rect x="5" y="16" width="11" height="3" rx="0.5" />
    </svg>
  );
}

function ContentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* kanban-style columns — matches the content pipeline mental model */}
      <rect x="3.5" y="4" width="5" height="16" rx="0.5" />
      <rect x="9.5" y="4" width="5" height="11" rx="0.5" />
      <rect x="15.5" y="4" width="5" height="14" rx="0.5" />
    </svg>
  );
}

function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.5-4 4.5-6 7-6s5.5 2 7 6" />
    </svg>
  );
}

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* three book spines on a shelf, leaning slightly so it reads as books
          rather than columns (which would clash with Content). */}
      <path d="M4 4.5v15l3 .5V5.5z" />
      <path d="M10 4.5v15l3 .5V5.5z" />
      <path d="M16.2 5.8l3 14.7 1.5-.4-3-14.7z" />
    </svg>
  );
}
