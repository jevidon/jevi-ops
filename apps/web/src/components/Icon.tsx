// Thin-stroke icon set for the v2 shell (design handoff, Jul 2026). Ported
// verbatim from the prototype's ICONS map — a 24×24 stroke language derived
// from the repo's BottomTabBar icons (clock, gantt bars, kanban columns, book
// spines) with Tasks / Companies / Routines / Health drawn to match.
//
// Paths live as raw SVG strings and are injected with dangerouslySetInnerHTML
// so the set stays a 1:1 copy of the source; there is no user data here.

export type IconName =
  | 'today' | 'work' | 'tasks' | 'content' | 'people' | 'companies'
  | 'library' | 'routines' | 'health'
  | 'search' | 'capture' | 'bell' | 'flag' | 'gear' | 'ask' | 'pin'
  | 'chev' | 'arrow' | 'x' | 'check';

const ICONS: Record<IconName, string> = {
  today: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  work: '<rect x="3" y="5" width="13" height="3" rx=".5"/><rect x="7" y="10.5" width="14" height="3" rx=".5"/><rect x="5" y="16" width="11" height="3" rx=".5"/>',
  tasks: '<rect x="3.5" y="4.5" width="6" height="6" rx=".5"/><path d="M5.2 7.4l1.3 1.3 2.3-2.6"/><rect x="3.5" y="13.5" width="6" height="6" rx=".5"/><path d="M13 7.5h7.5M13 16.5h7.5"/>',
  content: '<rect x="3.5" y="4" width="5" height="16" rx=".5"/><rect x="9.5" y="4" width="5" height="11" rx=".5"/><rect x="15.5" y="4" width="5" height="14" rx=".5"/>',
  people: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-4 4.5-6 7-6s5.5 2 7 6"/>',
  companies: '<rect x="3.5" y="4" width="7.5" height="16" rx=".5"/><rect x="13.5" y="9.5" width="7" height="10.5" rx=".5"/><path d="M6.2 8h2.2M6.2 12h2.2M16.2 13.5h1.8"/>',
  library: '<path d="M4 4.5v15l3 .5V5.5z"/><path d="M10 4.5v15l3 .5V5.5z"/><path d="M16.2 5.8l3 14.7 1.5-.4-3-14.7z"/>',
  routines: '<path d="M4.5 9.5a7.5 7.5 0 0113-4.2M19.5 14.5a7.5 7.5 0 01-13 4.2"/><path d="M4.5 5.5v4h4M19.5 18.5v-4h-4"/>',
  // Health is feature-flagged and usually absent; a simple pulse line.
  health: '<path d="M3.5 12.5h4l2-5 3 10 2.5-7 1.5 2h4.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.2 16.2L21 21"/>',
  capture: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M12 4a5.5 5.5 0 00-5.5 5.5c0 4-1.5 5.5-1.5 5.5h14s-1.5-1.5-1.5-5.5A5.5 5.5 0 0012 4zM10.2 18.5a2 2 0 003.6 0"/>',
  flag: '<path d="M6 21V4.5M6 4.5h11l-2 3.5 2 3.5H6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5l1.7 1-2 3.4-1.9-.7a7.6 7.6 0 01-1.7 1l-.3 2h-4l-.3-2a7.6 7.6 0 01-1.7-1l-1.9.7-2-3.4 1.7-1a7 7 0 010-2l-1.7-1 2-3.4 1.9.7a7.6 7.6 0 011.7-1l.3-2h4l.3 2c.6.25 1.2.58 1.7 1l1.9-.7 2 3.4-1.7 1a7 7 0 010 2z"/>',
  // "Ask" / chat.
  ask: '<path d="M20.5 12.5c0 3.6-3.8 6.5-8.5 6.5-1 0-2-.13-2.9-.37L4 20.5l1.3-3.4A6.9 6.9 0 013.5 12.5C3.5 8.9 7.3 6 12 6s8.5 2.9 8.5 6.5z"/>',
  pin: '<path d="M15 3.5l5.5 5.5-2.2 2.2-1-.4-3.6 3.6.5 3.6-1.6 1.6-3.4-3.4L5 21l-.5-.5 4.8-4.2-3.4-3.4L7.5 11l3.6.5 3.6-3.6-.4-1z"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  arrow: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5l4.5 4.5 10-10"/>',
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.5,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
