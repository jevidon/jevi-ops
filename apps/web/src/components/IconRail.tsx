'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutAction } from '@/app/sign-in/actions';
import { Icon, type IconName } from './Icon';

// v2 collapsible icon rail (design handoff, Jul 2026). Replaces the permanent
// 220px DesktopRail. Collapsed it is 64px of icons; it expands to 236px on
// hover as an OVERLAY (the 64px slot stays, so content doesn't shift), and
// pinning (the pin button or `[`) widens the SLOT so the rail pushes layout
// instead of covering it. Pin persists in localStorage. On touch, icon taps
// navigate directly; tapping empty rail space expands the overlay, which
// closes on navigation or an outside tap.
//
// Carried forward from DesktopRail (do not regress): health/routines flag
// gating, the Ask/chat link, the account + sign-out footer, the Capture
// dispatch, and Today-subview highlighting (now only /inbox — Tasks got its
// own tab per the v2 handoff, confirmed with Jerad).

const RAIL = 64;
const RAIL_OPEN = 236;

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  flag?: 'health' | 'routines';
}

// No Today/home item — the brand block above the nav is the home link
// (the Briefing lives at `/` now).
const NAV: NavItem[] = [
  { href: '/work', label: 'Work', icon: 'work' },
  { href: '/tasks', label: 'Tasks', icon: 'tasks' },
  { href: '/content', label: 'Content', icon: 'content' },
  { href: '/people', label: 'People', icon: 'people' },
  { href: '/companies', label: 'Companies', icon: 'companies' },
  { href: '/library', label: 'Library', icon: 'library' },
  { href: '/routines', label: 'Routines', icon: 'routines', flag: 'routines' },
  { href: '/health', label: 'Health', icon: 'health', flag: 'health' },
];

// Synthesize a Cmd/Ctrl+J so the global TextCapturePalette opens (same trick
// the old rail used — cheaper than exposing a shared open()).
function dispatchOpenCapture() {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'j', code: 'KeyJ', metaKey: isMac, ctrlKey: !isMac, bubbles: true,
    }),
  );
}

export function IconRail({
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
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  // Keyboard focus expands the rail too, so tabbing through nav shows labels
  // (and the account/sign-out row leaves its collapsed, non-tabbable state).
  const [focused, setFocused] = useState(false);
  // Touch is its own channel: hover is mouse-only (an emulated mouseenter on
  // tap would mutate the rail and make iOS swallow the click, forcing a second
  // tap to actually navigate), so on touch an icon tap navigates directly and
  // a tap on empty rail space is what expands it.
  const [touchOpen, setTouchOpen] = useState(false);
  const open = pinned || hover || focused || touchOpen;

  // Arriving at a new page drops the touch-expand and the clicked link's
  // focus — either would hold the unpinned rail open indefinitely (touch has
  // no mouseleave; a focused link never blurs on its own). Hover is left
  // alone: while the cursor sits on the rail it stays open, and mousing off
  // collapses it as usual.
  useEffect(() => {
    setTouchOpen(false);
    setFocused(false);
  }, [pathname]);

  // A tap anywhere outside the touch-expanded rail dismisses it.
  useEffect(() => {
    if (!touchOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setTouchOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [touchOpen]);

  // Restore pin from localStorage on mount (avoids an SSR/first-paint mismatch
  // by starting unpinned and correcting client-side).
  useEffect(() => {
    setPinned(localStorage.getItem('jops2.pin') === '1');
  }, []);

  const togglePin = () =>
    setPinned((v) => {
      const next = !v;
      localStorage.setItem('jops2.pin', next ? '1' : '0');
      return next;
    });

  // `[` toggles the pin, unless focus is in ANY editable host — inputs,
  // selects, and contentEditable surfaces like RichComposer (a `[` there is a
  // real character, not a nav command).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // instanceof, not a cast: synthetic events dispatched on window (the
      // Capture button replays ⌘J that way) arrive with target = window,
      // which has no tagName/closest.
      const el = e.target instanceof HTMLElement ? e.target : null;
      const editable =
        !!el &&
        (/input|textarea|select/i.test(el.tagName) ||
          el.isContentEditable ||
          !!el.closest('[contenteditable="true"], [role="textbox"]'));
      if (e.key === '[' && !editable) togglePin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tabs = NAV.filter(
    (t) =>
      (t.flag !== 'health' || healthEnabled) && (t.flag !== 'routines' || routinesEnabled),
  );

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    // The slot reserves layout width; the rail itself is FIXED to the viewport
    // so it stays put (and its footer stays visible) no matter how far the page
    // scrolls, and overhangs the content when expanded-on-hover.
    <div
      className="hidden lg:block shrink-0 transition-[width] duration-200 ease-out"
      style={{ width: pinned ? RAIL_OPEN : RAIL }}
    >
      <nav
        ref={navRef}
        aria-label="Primary"
        onPointerEnter={(e) => {
          if (e.pointerType !== 'touch') setHover(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'touch') setHover(false);
        }}
        onPointerUp={(e) => {
          // Touch, empty space only (icon taps navigate on their own): toggle
          // the expanded state. Pinned rail is already held open.
          if (e.pointerType !== 'touch' || pinned) return;
          if (!(e.target as HTMLElement).closest('a, button')) setTouchOpen((v) => !v);
        }}
        onFocusCapture={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
        // z-40: above sticky page content (z-10/20/30), below full-screen modals
        // like TextCapturePalette (z-50) so the collapsed rail can't paint over
        // the ⌘J palette.
        className="fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden bg-surface border-r border-line transition-[width] duration-200 ease-out"
        style={{
          width: open ? RAIL_OPEN : RAIL,
          boxShadow: open && !pinned ? '18px 0 40px -18px rgba(18,16,14,0.22)' : 'none',
        }}
      >
        {/* Brand — doubles as the home link (the Briefing at `/`). */}
        <Link
          href="/"
          className="flex items-center gap-3 h-[60px] px-[19px] shrink-0 border-b border-line group/brand"
        >
          <span
            className="grid place-items-center shrink-0 w-[26px] h-[26px] rounded-md bg-accent"
            aria-hidden
          >
            {/* Almanac eight-point star — same geometry as the favicon set
                (outer R 13.2 / inner r 5.2 in a 32 box). */}
            <svg viewBox="0 0 32 32" className="w-[19px] h-[19px] fill-bg">
              <polygon points="16,2.8 17.99,11.2 25.33,6.67 20.8,14.01 29.2,16 20.8,17.99 25.33,25.33 17.99,20.8 16,29.2 14.01,20.8 6.67,25.33 11.2,17.99 2.8,16 11.2,14.01 6.67,6.67 14.01,11.2" />
            </svg>
          </span>
          <span
            className={`whitespace-nowrap transition-opacity duration-100 ${open ? 'opacity-100' : 'opacity-0'}`}
          >
            <span className="block font-serif font-medium text-[15px] leading-[1.1] tracking-[-0.01em] text-ink group-hover/brand:text-accent transition-colors">
              Almanac
            </span>
            <span className="block font-mono text-[9px] leading-[1.4] tracking-[0.1em] uppercase text-ink-3">
              a jevi operation
            </span>
          </span>
        </Link>

        {/* Primary nav */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-[10px]">
          {tabs.map((t) => (
            <RailItem key={t.href} href={t.href} icon={t.icon} label={t.label} active={isActive(t.href)} open={open} />
          ))}
        </div>

        {/* Utility footer */}
        <div className="shrink-0 border-t border-line py-2">
          <RailItem icon="capture" label="Capture" open={open} onClick={dispatchOpenCapture} hint="⌘J" />
          <RailItem icon="search" label="Search" href="/search" active={isActive('/search')} open={open} hint="⌘K" />
          <RailItem icon="ask" label="Ask" href="/chat" active={isActive('/chat')} open={open} />
          <RailItem
            icon="flag" label="Attention" href="/attention" active={isActive('/attention')} open={open}
            badge={attentionActive > 0 ? (attentionActive > 99 ? '99+' : String(attentionActive)) : undefined}
          />
          <RailItem
            icon="bell" label="Notifications" href="/notifications" active={isActive('/notifications')} open={open}
            badge={unreadNotifications > 0 ? (unreadNotifications > 99 ? '99+' : String(unreadNotifications)) : undefined}
            badgeAccent
          />
          <RailItem icon="gear" label="Settings" href="/settings" active={isActive('/settings')} open={open} />
          <RailItem
            icon="pin" label={pinned ? 'Unpin nav' : 'Keep open'} open={open} onClick={togglePin}
            iconStyle={{ transform: pinned ? 'none' : 'rotate(-40deg)', opacity: pinned ? 1 : 0.7 }}
          />

          {/* Account + sign out — only legible when expanded. */}
          {email && (
            <div
              className={`mt-1 border-t border-line px-[21px] pt-2 pb-1 flex items-center justify-between gap-2 transition-opacity duration-100 ${
                open ? 'opacity-100' : 'opacity-0 invisible pointer-events-none'
              }`}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3 truncate">
                {email}
              </span>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3 hover:text-accent transition-colors shrink-0"
                >
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}

// One rail row. Renders a Link when `href` is set, else a button (Capture,
// pin). The label + badge + hint fade in only when the rail is open.
function RailItem({
  href, icon, label, active, open, onClick, badge, badgeAccent, hint, iconStyle,
}: {
  href?: string;
  icon: IconName;
  label: string;
  active?: boolean;
  open: boolean;
  onClick?: () => void;
  badge?: string;
  badgeAccent?: boolean;
  hint?: string;
  iconStyle?: React.CSSProperties;
}) {
  const body = (
    <>
      {active && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" aria-hidden />}
      <span className="relative shrink-0 w-[22px] grid place-items-center">
        <Icon name={icon} size={20} style={iconStyle} />
        {/* Collapsed state: the numeric badge is hidden, so a dot keeps the
            unread/attention signal visible (desktop has no other indicator —
            NotificationBell is lg:hidden). */}
        {badge && !open && (
          <span
            className={`absolute -top-0.5 -right-0.5 w-[7px] h-[7px] rounded-full border border-surface ${badgeAccent ? 'bg-accent' : 'bg-ink'}`}
            aria-hidden
          />
        )}
      </span>
      <span
        className={`text-[13.5px] whitespace-nowrap transition-opacity duration-100 ${open ? 'opacity-100' : 'opacity-0'}`}
      >
        {label}
      </span>
      {badge && (
        <span
          className={`ml-auto font-mono text-[10px] leading-none px-1.5 py-[3px] rounded-full transition-opacity duration-100 ${
            open ? 'opacity-100' : 'opacity-0'
          } ${badgeAccent ? 'bg-accent text-bg' : 'bg-ink text-bg'}`}
        >
          {badge}
        </span>
      )}
      {hint && !badge && (
        <span
          className={`ml-auto font-mono text-[10px] leading-none text-ink-3 transition-opacity duration-100 ${open ? 'opacity-100' : 'opacity-0'}`}
        >
          {hint}
        </span>
      )}
    </>
  );

  const cls = `group relative flex items-center gap-[14px] w-full h-10 px-[21px] whitespace-nowrap transition-colors hover:bg-[color:rgb(var(--ink)_/_0.035)] ${
    active ? 'text-ink font-semibold' : 'text-ink-2 hover:text-ink'
  }`;

  if (href) {
    return (
      <Link href={href} className={cls} title={label}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} title={label}>
      {body}
    </button>
  );
}
