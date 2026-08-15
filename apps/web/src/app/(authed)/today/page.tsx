import Link from 'next/link';
import {
  briefingApi,
  libraryApi,
  notificationsApi,
  routinesApi,
  tasksApi,
  attentionApi,
  focusApi,
  ApiError,
  type BriefingPayload,
  type ResurfacingItem,
  type RoutineListItem,
  type AttentionItem,
} from '@/lib/api';
import { AttentionItemRow } from '@/components/attention/AttentionItemRow';
import type { Task } from '@jevi-ops/shared';
import { getAppTimezone, getFeatureFlag } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { Pill } from '@/components/Pill';
import { BriefLineRow } from './brief-line';
import { RoutinesTodayList } from '@/app/(authed)/routines/routines-today-list';
import { TaskItem } from '@/components/TaskItem';
import {
  getResurfacingSeen,
  skipResurfacingAction,
  resetResurfacingAction,
} from './actions';

// The Briefing — editorial home screen (v2 redesign, Jul 2026).
//
// Lead with state, not a checklist. Masthead carries a derived summary pillrow
// (overdue · open · waiting · routines). Two columns: a ledger left (Needs a
// move slip cards → Attention → Reflection → Latest quote) and an ambient,
// sticky rail right (events · Doing · Routines). Everything the Addendum-09
// route surfaced survives — Focus line, Inbox triage, Reflection, Latest
// quote. (Upstream's Silent-clients section is CRM scope — not in this fork.)

function mastheadDate(tz: string): string {
  const d = new Date();
  const isoWeek = computeIsoWeek(d, tz);
  return (
    d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: '2-digit' }).toUpperCase()
    + ` · WEEK ${isoWeek}`
  );
}

function computeIsoWeek(now: Date, tz: string): number {
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export default async function TodayPage() {
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);
  const routinesEnabled = await getFeatureFlag('routines_module_enabled');
  let briefing: BriefingPayload | null = null;
  let resurface: ResurfacingItem | null = null;
  let routines: RoutineListItem[] = [];
  let unreadCount = 0;
  let errorMessage: string | null = null;

  const resurfacingSkip = await getResurfacingSeen();

  let allTasks: Task[] = [];
  let resurfaceExhausted = false;
  let attentionItems: AttentionItem[] = [];
  let attentionActiveCount = 0;
  let focus: { href: string; title: string; note: string | null } | null = null;

  const [briefingRes, resurfaceRes, countRes, routinesRes, tasksRes, attentionRes, attentionCountRes, focusRes] = await Promise.allSettled([
    briefingApi.today(),
    libraryApi.resurfacing({ skip: resurfacingSkip }),
    notificationsApi.count(),
    routinesApi.list(),
    tasksApi.list(),
    attentionApi.list({ status: 'active', limit: 50 }),
    attentionApi.count(),
    focusApi.get(today),
  ]);
  if (tasksRes.status === 'fulfilled') allTasks = tasksRes.value.tasks;
  if (focusRes.status === 'fulfilled' && focusRes.value.focus) {
    const f = focusRes.value.focus;
    focus = {
      href: f.target_type === 'project' ? `/projects/${f.target_id}` : `/content/${f.target_id}`,
      title: f.title,
      note: f.note ?? null,
    };
  }
  if (attentionCountRes.status === 'fulfilled') attentionActiveCount = attentionCountRes.value.active;
  if (attentionRes.status === 'fulfilled') {
    const active = attentionRes.value.items;
    attentionItems = active
      .filter((i) => i.urgency === 'high' || i.urgency === 'normal')
      .slice(0, 5);
  }
  if (resurfaceRes.status === 'fulfilled') {
    resurfaceExhausted = Boolean(resurfaceRes.value.exhausted);
    resurface = resurfaceRes.value.item;
  }
  if (briefingRes.status === 'fulfilled') {
    briefing = briefingRes.value;
  } else {
    const err = briefingRes.reason;
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }
  if (countRes.status === 'fulfilled') unreadCount = countRes.value.unread;
  if (routinesRes.status === 'fulfilled') {
    routines = routinesRes.value.routines.filter((r) => r.active && !r.archived_at);
  }

  // Right-rail actionable tasks: Top-3 for today, then overdue, then due today.
  const openTasks = allTasks.filter((t) => t.status === 'open');
  const top3 = openTasks
    .filter((t) => t.top3_for_date === today)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const top3Ids = new Set(top3.map((t) => t.id));
  const overdue = openTasks
    .filter((t) => !top3Ids.has(t.id) && t.due_date && t.due_date < today)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  const dueToday = openTasks
    .filter((t) => !top3Ids.has(t.id) && t.due_date === today)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const RAIL_CAP = 10;
  const railTasksAll = [...top3, ...overdue, ...dueToday];
  const railTasks = railTasksAll.slice(0, RAIL_CAP);
  const railOverflow = Math.max(0, railTasksAll.length - RAIL_CAP);

  // Masthead summary pills — all derived, no backend change.
  const overdueCount = briefing?.doing_today.overdue_count ?? 0;
  const openCount = briefing?.doing_today.open_count ?? openTasks.length;
  const waitingCount = allTasks.filter((t) => t.status === 'waiting').length;
  const rDone = briefing?.routines_today.done ?? routines.filter((r) => r.stats.done_today).length;
  const rTotal = briefing?.routines_today.total ?? routines.length;

  const meta = mastheadDate(tz);
  const anchorLine = buildAnchorLine(briefing);

  return (
    <div className="pb-32">
      {/* ─── Masthead ──────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <div className="eyebrow mb-2">
              {meta}
              {unreadCount > 0 && (
                <>
                  {' · '}
                  <Link href="/notifications" className="text-accent hover:underline">
                    {unreadCount} unread
                  </Link>
                </>
              )}
            </div>
            <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">The Briefing</h1>
          </div>
          <div className="flex items-center gap-2 pb-1 flex-wrap">
            {overdueCount > 0 && <Pill state="over">{overdueCount} overdue</Pill>}
            {openCount > 0 && <Pill state="due">{openCount} open</Pill>}
            {waitingCount > 0 && <Pill state="quiet">{waitingCount} waiting</Pill>}
            {routinesEnabled && rTotal > 0 && (
              <Pill state={rDone >= rTotal ? 'ok' : 'quiet'}>Routines {rDone}/{rTotal}</Pill>
            )}
          </div>
        </div>
      </div>
      <div className="hairline-strong mt-4 mx-5 lg:mx-0" />

      {/* ─── Today's focus (Addendum 09) ────────────────────────────── */}
      {focus && (
        <div className="px-5 lg:px-0 mt-4">
          <Link href={focus.href} className="group inline-flex items-baseline gap-2 hover:text-accent transition-colors">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">Focus</span>
            <span className="font-sans text-[15px] text-ink group-hover:text-accent transition-colors">{focus.title}</span>
            <span className="font-mono text-[11px] text-ink-3 group-hover:text-accent transition-colors">→</span>
          </Link>
          {focus.note && <div className="mt-0.5 font-sans text-[12px] text-ink-3">{focus.note}</div>}
        </div>
      )}

      {errorMessage && (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          Couldn&rsquo;t load the briefing: {errorMessage}
        </div>
      )}

      {anchorLine && (
        <div className="px-5 lg:px-0 mt-3 font-sans text-[12px] text-ink-2 leading-snug">{anchorLine}</div>
      )}

      {/* ─── Inbox triage ────────────────────────────────────────── */}
      {briefing && briefing.inbox_triage_count > 0 && (
        <Link
          href="/inbox"
          className="mt-5 mx-5 lg:mx-0 flex items-baseline justify-between gap-3 border-l-2 border-accent pl-3 py-2 hover:bg-accent/[0.04] transition-colors"
        >
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent">Inbox</div>
            <div className="font-sans text-[13px] text-ink mt-0.5">
              {briefing.inbox_triage_count}{' '}
              {briefing.inbox_triage_count === 1 ? 'task needs' : 'tasks need'} a home.
            </div>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent shrink-0">Triage →</span>
        </Link>
      )}

      {/* ─── Two columns ────────────────────────────────────────────
          Left ledger (flexible), right ambient rail (fixed 348px, sticky). */}
      <div className="mt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_348px] lg:gap-x-10 lg:items-start">
        {/* ─── Left ───────────────────────────────────────────── */}
        <div className="min-w-0">
          {/* Needs a move — cadence slip cards */}
          <section className="px-5 lg:px-0">
            <div className="flex items-baseline justify-between mb-3">
              <div className="eyebrow">
                Needs a move{briefing && briefing.brief_lines.length > 0 ? ` · ${briefing.brief_lines.length}` : ''}
              </div>
              <Link href="/work" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                All work →
              </Link>
            </div>
            {briefing && briefing.brief_lines.length === 0 ? (
              <p className="font-serif text-[15px] text-ink-2 italic leading-relaxed">
                Nothing past cadence. Every domain is within its rhythm — rare and worth noticing.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {briefing?.brief_lines.map((line) => <BriefLineRow key={line.id} line={line} />)}
              </div>
            )}
          </section>

          {/* Attention — active rules (waiting / content / ideas …) */}
          {attentionItems.length > 0 && (
            <section className="mt-9 px-5 lg:px-0">
              <div className="flex items-baseline justify-between mb-2">
                <div className="eyebrow">
                  Attention{attentionActiveCount > 0 ? ` · ${attentionActiveCount} active` : ''}
                </div>
                {attentionActiveCount > attentionItems.length && (
                  <Link href="/attention" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                    See all →
                  </Link>
                )}
              </div>
              <ul>
                {attentionItems.map((it) => <AttentionItemRow key={it.id} item={it} />)}
              </ul>
            </section>
          )}

          {/* Reflection — resurfacing pull-quote */}
          {(resurface || resurfaceExhausted) && (
            <section className="mt-9 mx-5 lg:mx-0 bg-surface border-y border-line py-6 px-5">
              <div className="eyebrow mb-3">Reflection</div>
              {resurface ? (
                <>
                  <blockquote className="font-serif text-[19px] italic leading-snug text-ink">
                    &ldquo;{resurface.excerpt}&rdquo;
                  </blockquote>
                  {resurface.source && (
                    <div className="mt-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">— {resurface.source}</div>
                  )}
                  <div className="mt-3 flex items-center gap-4 flex-wrap">
                    {resurface.href && (
                      <Link href={resurface.href} className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-ink transition-colors">
                        Open in {resurface.kind === 'quote' ? 'Quotes' : 'Journal'} →
                      </Link>
                    )}
                    <form action={skipResurfacingAction}>
                      <input type="hidden" name="id" value={resurface.id} />
                      <button type="submit" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                        Next →
                      </button>
                    </form>
                    {resurfacingSkip.length > 0 && (
                      <form action={resetResurfacingAction}>
                        <button type="submit" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors" title={`${resurfacingSkip.length} skipped today`}>
                          Reset
                        </button>
                      </form>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="font-serif text-[17px] italic text-ink-2 leading-snug">
                    You&rsquo;ve seen every item in today&rsquo;s rotation. Tomorrow&rsquo;s pick will come from the same pool, fresh.
                  </p>
                  <form action={resetResurfacingAction} className="mt-3">
                    <button type="submit" className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-ink transition-colors">
                      Reset rotation now →
                    </button>
                  </form>
                </>
              )}
            </section>
          )}

          {/* Latest quote */}
          {briefing?.latest_quote && briefing.latest_quote.id !== resurface?.id && (
            <section className="mt-6 mx-5 lg:mx-0 border border-line py-5 px-5">
              <div className="eyebrow mb-3">Latest quote</div>
              <blockquote className="font-serif text-[17px] italic leading-snug text-ink">
                &ldquo;{briefing.latest_quote.text}&rdquo;
              </blockquote>
              {(briefing.latest_quote.source_author || briefing.latest_quote.source_reference) && (
                <div className="mt-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">
                  — {[briefing.latest_quote.source_author, briefing.latest_quote.source_reference].filter(Boolean).join(' · ')}
                </div>
              )}
              <div className="mt-3 flex items-center gap-4 flex-wrap">
                <Link href={briefing.latest_quote.href} className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-ink transition-colors">
                  Open quote →
                </Link>
                {briefing.latest_quote.source_url && (
                  <a href={briefing.latest_quote.source_url} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                    Open source ↗
                  </a>
                )}
              </div>
            </section>
          )}
        </div>

        {/* ─── Right: ambient rail (sticky) ───────────────────── */}
        <div className="mt-9 lg:mt-0 lg:sticky lg:top-[76px]">
          {briefing && briefing.events_today_count > 0 && (
            <section className="px-5 lg:px-0">
              <div className="flex items-baseline justify-between mb-3">
                <div className="eyebrow">
                  Today · {briefing.events_today_count} {briefing.events_today_count === 1 ? 'event' : 'events'}
                </div>
                <Link href="/calendar" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                  Open →
                </Link>
              </div>
              {briefing.next_event && (
                <Link href="/calendar" className="flex items-baseline gap-4 py-1.5 border-b border-line hover:opacity-80 transition-opacity">
                  <span className="font-mono text-[12px] text-ink tabular-nums shrink-0 w-12">{briefing.next_event.time}</span>
                  <span className="font-sans text-[13px] text-ink-2 truncate">{briefing.next_event.title}</span>
                </Link>
              )}
              {briefing.events_today_count > 1 && (
                <Link href="/calendar" className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                  + {briefing.events_today_count - 1} more →
                </Link>
              )}
            </section>
          )}

          {(railTasks.length > 0 || (briefing?.doing_today.open_count ?? 0) > 0) && (
            <section className="px-5 lg:px-0 mt-6">
              <div className="flex items-baseline justify-between mb-1">
                <div className="eyebrow">
                  Doing
                  {briefing && (
                    <>
                      {' · '}{briefing.doing_today.open_count} open
                      {briefing.doing_today.overdue_count > 0 && (
                        <span className="text-accent ml-1">· {briefing.doing_today.overdue_count} overdue</span>
                      )}
                    </>
                  )}
                </div>
                <Link href="/tasks" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                  All tasks →
                </Link>
              </div>
              <div className="mt-1">
                {railTasks.length === 0 ? (
                  <p className="font-sans text-[13px] text-ink-3 italic py-2">
                    No tasks overdue or due today. Star one below to pin it as Top 3.
                  </p>
                ) : (
                  railTasks.map((t) => (
                    <TaskItem
                      key={t.id}
                      task={t}
                      parentCrumb={t.parent_task_id ? (allTasks.find((p) => p.id === t.parent_task_id)?.title ?? null) : null}
                    />
                  ))
                )}
                {top3.length < 3 && railTasks.length > 0 && (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                    {3 - top3.length} Top 3 {3 - top3.length === 1 ? 'slot' : 'slots'} open · tap ☆ on a row to pin
                  </p>
                )}
                {railOverflow > 0 && (
                  <Link href="/tasks" className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                    + {railOverflow} more →
                  </Link>
                )}
              </div>
            </section>
          )}

          {routinesEnabled && (
            <section className="px-5 lg:px-0 mt-7">
              <div className="flex items-baseline justify-between mb-3">
                <div className="eyebrow">Routines · {rDone} of {rTotal} today</div>
                <Link href="/routines" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                  All →
                </Link>
              </div>
              {routines.length > 0 ? (
                <RoutinesTodayList routines={routines} compact today={today} />
              ) : (
                <Link href="/routines" className="block font-sans text-[13px] text-ink-3 italic hover:text-ink-2 transition-colors">
                  {routinesRes.status === 'rejected'
                    ? 'Couldn’t load routines — open /routines to check.'
                    : 'No active routines. Add one →'}
                </Link>
              )}
            </section>
          )}
        </div>
      </div>

      <CaptureChips />
    </div>
  );
}

function buildAnchorLine(briefing: BriefingPayload | null): React.ReactNode {
  if (!briefing) return null;
  const eventsCount = briefing.events_today_count;
  const tasksOpen = briefing.doing_today.open_count;
  if (eventsCount === 0 && tasksOpen === 0) return null;

  const parts: React.ReactNode[] = [];
  if (eventsCount > 0) {
    parts.push(
      <Link key="ev" href="/calendar" className="hover:text-ink hover:underline underline-offset-2 transition-colors">
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
      <Link key="tk" href="/tasks" className="hover:text-ink hover:underline underline-offset-2 transition-colors">
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

function CaptureChips() {
  const chips = [
    { label: 'Journal', href: '/library/journal/new' },
    { label: 'Quote', href: '/library/quotes/new' },
    { label: 'Note', href: '/library/notes/new' },
    { label: 'Task', href: '/tasks/new' },
  ];
  return (
    <section className="px-5 lg:px-0 mt-9">
      <div className="eyebrow mb-2">Capture</div>
      <div className="flex items-center gap-2 flex-wrap">
        {chips.map((c) => (
          <Link key={c.label} href={c.href} className="font-sans text-[12px] font-medium text-ink-2 hover:text-ink px-3 py-1.5 border border-line rounded whitespace-nowrap transition-colors">
            {c.label}
          </Link>
        ))}
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 ml-1">— or hold the mic.</span>
      </div>
    </section>
  );
}
