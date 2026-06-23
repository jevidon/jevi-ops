import Link from 'next/link';
import {
  briefingApi,
  libraryApi,
  notificationsApi,
  routinesApi,
  ApiError,
  type BriefingPayload,
  type ResurfacingItem,
  type RoutineListItem,
} from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { BriefLineRow } from './brief-line';
import { RoutinesTodayList } from '@/app/(authed)/routines/routines-today-list';

// The Briefing — editorial home screen (Jun 2026 redesign).
//
// Lead with state, not a checklist. The page reads like a newspaper:
// masthead → commitments anchor line → Inbox triage (when active) → "In
// brief" lines (one per slipping domain, with a fact and a routing label)
// → resurfaced pull-quote → today's events + "Doing today" + "Routines
// today" strips → capture chips.
//
// Tone is strict: facts only. "23 days since a journal entry." never
// "you should journal." Discomfort comes from size and prominence of
// facts, never from alert colors or nudge copy.

function mastheadDate(tz: string): { day: string; meta: string } {
  const d = new Date();
  const day = d.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  // Editorial "WEEK 26" style dateline. ISO week-of-year not in
  // Intl.DateTimeFormat — compute manually using the standard ISO formula.
  const isoWeek = computeIsoWeek(d, tz);
  const meta = d
    .toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: '2-digit' })
    .toUpperCase() + ` · WEEK ${isoWeek}`;
  return { day, meta };
}

function computeIsoWeek(now: Date, tz: string): number {
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const d = new Date(isoDate + 'T00:00:00Z');
  // Standard ISO week computation per Wikipedia.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export default async function TodayPage() {
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);
  let briefing: BriefingPayload | null = null;
  let resurface: ResurfacingItem | null = null;
  let routines: RoutineListItem[] = [];
  let unreadCount = 0;
  let errorMessage: string | null = null;

  const [briefingRes, resurfaceRes, countRes, routinesRes] = await Promise.allSettled([
    briefingApi.today(),
    libraryApi.resurfacing(),
    notificationsApi.count(),
    routinesApi.list(),
  ]);
  if (briefingRes.status === 'fulfilled') {
    briefing = briefingRes.value;
  } else {
    const err = briefingRes.reason;
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }
  if (resurfaceRes.status === 'fulfilled') resurface = resurfaceRes.value.item;
  if (countRes.status === 'fulfilled') unreadCount = countRes.value.unread;
  if (routinesRes.status === 'fulfilled') {
    // Only show active, non-archived routines on the Briefing — the
    // /routines page is the full management view.
    routines = routinesRes.value.routines.filter((r) => r.active && !r.archived_at);
  }

  const { day, meta } = mastheadDate(tz);

  // The commitments anchor: "4 events today — next 10:30 X. 3 tasks set."
  // Built from briefing.events + doing_today.open_count.
  const anchorLine = buildAnchorLine(briefing);

  return (
    <div className="pb-32">
      {/* ─── Masthead ──────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">
              {meta}
            </div>
            <h1 className="font-serif text-[26px] font-semibold leading-none tracking-[-0.5px] text-ink">
              The Briefing
            </h1>
          </div>
          <Link
            href="/notifications"
            aria-label={`${unreadCount} unread notifications`}
            className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors"
          >
            {unreadCount > 0 && <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />}
            <span>{unreadCount}</span>
          </Link>
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {day}
        </div>
      </div>
      <div className="hairline-strong mt-3 mx-5 lg:mx-0" />

      {errorMessage && (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          Couldn&rsquo;t load the briefing: {errorMessage}
        </div>
      )}

      {/* ─── Commitments anchor line ─────────────────────────────── */}
      {anchorLine && (
        <div className="px-5 lg:px-0 mt-3 font-sans text-[12px] text-ink-2 leading-snug">
          {anchorLine}
        </div>
      )}

      {/* ─── Inbox triage strip ──────────────────────────────────── */}
      {briefing && briefing.inbox_triage_count > 0 && (
        <Link
          href="/inbox"
          className="mt-5 mx-5 lg:mx-0 flex items-baseline justify-between gap-3 border-l-2 border-accent pl-3 py-2 hover:bg-accent/[0.04] transition-colors"
        >
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
              Inbox
            </div>
            <div className="font-sans text-[13px] text-ink mt-0.5">
              {briefing.inbox_triage_count}{' '}
              {briefing.inbox_triage_count === 1 ? 'task needs' : 'tasks need'} a home.
            </div>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent shrink-0">
            Triage →
          </span>
        </Link>
      )}

      {/* ─── Two-column grid on desktop ─────────────────────────────
          Mobile keeps the original vertical flow (single column).
          Desktop splits into editorial (in brief + resurfaced) on the
          left and commitments + routines on the right so the whole
          briefing fits in one viewport without scrolling. Inbox above
          and Capture below stay full-width. Matches the design brief's
          BriefingDesktop pattern, with routines added to the right rail
          per Jerad's daily check-off use case. */}
      <div className="mt-7 lg:grid lg:grid-cols-[1.5fr_1fr] lg:gap-x-10 lg:items-start">
        {/* ─── Left: editorial body ───────────────────────────── */}
        <div>
          {/* In brief */}
          <section className="px-5 lg:px-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-3">
              In brief
            </div>
            {briefing && briefing.brief_lines.length === 0 ? (
              <p className="font-serif text-[15px] text-ink-2 italic leading-relaxed">
                Nothing past cadence. Every domain is within its rhythm —
                rare and worth noticing.
              </p>
            ) : (
              briefing?.brief_lines.map((line) => (
                <BriefLineRow key={line.id} line={line} />
              ))
            )}
          </section>

          {/* Resurfaced */}
          {resurface && (
            <section className="mt-9 mx-5 lg:mx-0 bg-surface border-y border-line py-6 px-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-3">
                Resurfaced
              </div>
              <blockquote className="font-serif text-[19px] italic leading-snug text-ink">
                &ldquo;{resurface.excerpt}&rdquo;
              </blockquote>
              {resurface.source && (
                <div className="mt-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">
                  — {resurface.source}
                </div>
              )}
              {resurface.href && (
                <Link
                  href={resurface.href}
                  className="mt-3 inline-block font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-ink transition-colors"
                >
                  Open in {resurface.kind === 'quote' ? 'Quotes' : 'Journal'} →
                </Link>
              )}
            </section>
          )}
        </div>

        {/* ─── Right: commitments rail ────────────────────────── */}
        <div className="mt-9 lg:mt-0">
          {/* Today: events. Whole section is a doorway to /calendar so
              tapping the next-event row jumps straight to the day view. */}
          {briefing && briefing.events_today_count > 0 && (
            <section className="px-5 lg:px-0">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                  Today · {briefing.events_today_count}{' '}
                  {briefing.events_today_count === 1 ? 'event' : 'events'}
                </div>
                <Link
                  href="/calendar"
                  className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
                >
                  Open →
                </Link>
              </div>
              {briefing.next_event && (
                <Link
                  href="/calendar"
                  className="flex items-baseline gap-4 py-1.5 border-b border-line hover:opacity-80 transition-opacity"
                >
                  <span className="font-mono text-[12px] text-ink tabular-nums shrink-0 w-12">
                    {briefing.next_event.time}
                  </span>
                  <span className="font-sans text-[13px] text-ink-2 truncate">
                    {briefing.next_event.title}
                  </span>
                </Link>
              )}
              {briefing.events_today_count > 1 && (
                <Link
                  href="/calendar"
                  className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
                >
                  + {briefing.events_today_count - 1} more →
                </Link>
              )}
            </section>
          )}

          {/* Doing today strip */}
          {briefing && briefing.doing_today.open_count > 0 && (
            <Link
              href="/tasks"
              className="px-5 lg:px-0 mt-6 block hover:opacity-80 transition-opacity"
            >
              <div className="flex items-baseline justify-between mb-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                  Doing · {briefing.doing_today.open_count} open
                  {briefing.doing_today.overdue_count > 0 && (
                    <span className="text-accent ml-1">
                      · {briefing.doing_today.overdue_count} overdue
                    </span>
                  )}
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  Open →
                </span>
              </div>
              <div className="font-sans text-[13px] text-ink-2 leading-snug">
                {briefing.doing_today.titles.length > 0
                  ? briefing.doing_today.titles.join(' · ')
                  : 'No priorities pinned. Tap to open the task list.'}
              </div>
            </Link>
          )}

          {/* Routines (inline check-off). Header renders even when the
              fetch returns empty so a silent failure (auth, network,
              server) is told apart from a real empty state. */}
          <section className="px-5 lg:px-0 mt-7">
            <div className="flex items-baseline justify-between mb-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                Routines · {briefing?.routines_today.done ?? 0} of{' '}
                {briefing?.routines_today.total ?? routines.length} today
              </div>
              <Link
                href="/routines"
                className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
              >
                All →
              </Link>
            </div>
            {routines.length > 0 ? (
              <RoutinesTodayList routines={routines} compact today={today} />
            ) : (
              <Link
                href="/routines"
                className="block font-sans text-[13px] text-ink-3 italic hover:text-ink-2 transition-colors"
              >
                {routinesRes.status === 'rejected'
                  ? 'Couldn’t load routines — open /routines to check.'
                  : 'No active routines. Add one →'}
              </Link>
            )}
          </section>
        </div>
      </div>


      {/* ─── Capture chips ───────────────────────────────────────── */}
      <CaptureChips />
    </div>
  );
}

function buildAnchorLine(briefing: BriefingPayload | null): React.ReactNode {
  if (!briefing) return null;
  const eventsCount = briefing.events_today_count;
  const tasksOpen = briefing.doing_today.open_count;
  if (eventsCount === 0 && tasksOpen === 0) return null;

  // Each clause is a Link so the user can tap the count to jump straight
  // to the calendar or task list. Underline on hover is the editorial
  // convention here — chip styling would feel too heavy in this row.
  const parts: React.ReactNode[] = [];
  if (eventsCount > 0) {
    parts.push(
      <Link
        key="ev"
        href="/calendar"
        className="hover:text-ink hover:underline underline-offset-2 transition-colors"
      >
        {eventsCount} {eventsCount === 1 ? 'event' : 'events'} today
        {briefing.next_event && (
          <>
            {' '}— next{' '}
            <span className="font-mono text-ink-2 tabular-nums">{briefing.next_event.time}</span>{' '}
            {briefing.next_event.title}
          </>
        )}
        .
      </Link>,
    );
  }
  if (tasksOpen > 0) {
    parts.push(
      <Link
        key="tk"
        href="/tasks"
        className="hover:text-ink hover:underline underline-offset-2 transition-colors"
      >
        {' '}
        {tasksOpen} {tasksOpen === 1 ? 'task' : 'tasks'} open
        {briefing.doing_today.overdue_count > 0 && (
          <span className="text-accent"> · {briefing.doing_today.overdue_count} overdue</span>
        )}
        .
      </Link>,
    );
  }
  return parts;
}

// Capture chip strip — in-flow at the bottom of the Briefing (the
// floating MicFAB occupies the bottom-right corner; a fixed strip would
// collide). Each chip routes to a compose surface; voice handles the
// same actions via the FAB. The full CaptureMenu bottom-sheet (per
// Section 6 of the brief) is a later phase.
function CaptureChips() {
  const chips = [
    { label: 'Journal', href: '/library/journal' },
    { label: 'Quote', href: '/library/quotes/new' },
    { label: 'Note', href: '/library/notes' },
    { label: 'Task', href: '/tasks/new' },
  ];
  return (
    <section className="px-5 lg:px-0 mt-9">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">
        Capture
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {chips.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="font-sans text-[12px] font-medium text-ink-2 hover:text-ink px-3 py-1.5 border border-line whitespace-nowrap transition-colors"
          >
            {c.label}
          </Link>
        ))}
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 ml-1">
          — or hold the mic.
        </span>
      </div>
    </section>
  );
}
