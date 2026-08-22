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
import type { Task } from '@jevi-ops/shared';
import { getAppSettings, getFeatureFlag } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { Pill } from '@/components/Pill';
import { getResurfacingSeen } from './today/actions';
import {
  activePanels,
  mergePanelConfig,
  type BriefingContext,
  type PanelDef,
} from './_briefing/registry';

// The Briefing — editorial home screen (v2 redesign, Jul 2026; panel system
// Aug 2026). Lead with state, not a checklist.
//
// Fixed chrome (masthead + pills, Focus line, Inbox triage, error banner,
// Capture chips) frames two columns of PANELS — a ledger left, an ambient
// sticky rail right — composed from _briefing/registry.tsx in the order the
// user configured under Settings → Briefing. Shared data is fetched once
// here and passed down as BriefingContext; panels with exclusive data
// (pins, agenda, health) fetch their own inside the panel, so a disabled
// panel costs zero fetches and async siblings render concurrently.
//
// Columns space panels with a `section + section` sibling selector: every
// panel's root is a <section> or null, so an empty panel leaves no gap.

const SILENT_CAP = 6;

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
  const settings = await getAppSettings();
  const tz = settings.timezone;
  const today = todayIsoDate(tz);
  const routinesEnabled = await getFeatureFlag('routines_module_enabled');
  const healthEnabled = await getFeatureFlag('health_module_enabled');
  let briefing: BriefingPayload | null = null;
  let resurface: ResurfacingItem | null = null;
  let routines: RoutineListItem[] = [];
  let unreadCount = 0;
  let errorMessage: string | null = null;

  const resurfacingSkip = await getResurfacingSeen();

  let allTasks: Task[] = [];
  let resurfaceExhausted = false;
  let attentionItems: AttentionItem[] = [];
  let silentClients: AttentionItem[] = [];
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
    // Silent clients (company_silent) get their own panel — pull them out of
    // the general Attention list so they're never shown twice.
    silentClients = active.filter((i) => i.rule_type === 'company_silent').slice(0, SILENT_CAP);
    attentionItems = active
      .filter((i) => i.rule_type !== 'company_silent')
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

  // Doing-rail tasks: Top-3 for today, then overdue, then due today.
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

  // ─── Panel composition ─────────────────────────────────────────────
  const ctx: BriefingContext = {
    tz,
    today,
    briefing,
    resurface,
    resurfaceExhausted,
    resurfacingSkipCount: resurfacingSkip.length,
    routines,
    routinesFailed: routinesRes.status === 'rejected',
    silentClients,
    attentionItems,
    attentionActiveCount,
    railTasks,
    railOverflow,
    top3Count: top3.length,
    rDone,
    rTotal,
  };
  const config = mergePanelConfig(settings.briefing_panels);
  const flags = { routines_module_enabled: routinesEnabled, health_module_enabled: healthEnabled };
  const mainPanels = activePanels(config, 'main', flags);
  const railPanels = activePanels(config, 'rail', flags);
  const renderPanel = (def: PanelDef) => {
    const Panel = def.Panel;
    return <Panel key={def.id} ctx={ctx} />;
  };

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
            <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">The Almanac</h1>
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

      {/* ─── Two panel columns ──────────────────────────────────────
          Left ledger (flexible), right ambient rail (fixed 348px, sticky).
          Panel gaps come from the sibling selectors, so empty panels
          (rendering null) contribute nothing. */}
      <div className="mt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_348px] lg:gap-x-10 lg:items-start">
        <div className="min-w-0 [&>section+section]:mt-9">
          {mainPanels.map(renderPanel)}
        </div>
        <div className="mt-9 lg:mt-0 lg:sticky lg:top-[76px] [&>section+section]:mt-6">
          {railPanels.map(renderPanel)}
        </div>
      </div>

      <CaptureChips />
    </div>
  );
}

function CaptureChips() {
  const chips = [
    { label: 'Journal', href: '/library/journal/new' },
    { label: 'Quote', href: '/library/quotes/new' },
    { label: 'Note', href: '/library/notes/new' },
    { label: 'Task', href: '/tasks/new?from=/' },
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
