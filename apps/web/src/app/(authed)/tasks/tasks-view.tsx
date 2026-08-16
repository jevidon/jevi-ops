'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Task } from '@jevi-ops/shared';
import { isRecurrencePattern } from '@jevi-ops/shared';
import { Icon } from '@/components/Icon';
import { FacetRail, FacetGroup, FacetRow, FacetTag, FacetTags, FacetSep } from '@/components/FacetRail';
import { FilterInput, textMatches } from '@/components/FilterInput';
import { domainColor } from '@/lib/domain-colors';
import { isToday } from '@/lib/today';
import { toggleTaskDoneAction } from '../today/actions';

// Tasks — the full list (Addendum 08 + v2 redesign, Jul 2026). Left facet rail
// (View / Domain / Priority) filters the list; groups follow the route
// (Overdue · Today · Upcoming · No date · Waiting), Project view groups by
// project. Priority rings on the checkbox; the four-state waiting treatment is
// preserved. Completed-today collapses at the bottom.
//
// Deferred from the handoff (need infrastructure they don't have yet): drag-to-
// reorder (no task order column) and the per-row schedule/move/comment popovers.

type View = 'all' | 'today' | 'upcoming' | 'project';
const VIEWS: [View, string][] = [
  ['all', 'All'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['project', 'Project'],
];
const GROUPS = ['Overdue', 'Today', 'Upcoming', 'No date', 'Waiting'] as const;
type GroupName = (typeof GROUPS)[number];

// Priority ring colours (P1 accent · P2 warn · P3 blue · P4 ink-4). NOT status —
// a P1 task can still be on track.
const PRIO_RING: Record<number, string> = {
  1: 'border-accent', 2: 'border-warn', 3: 'border-prio3', 4: 'border-ink-4',
};

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

interface DueInfo {
  state: 'over' | 'due' | 'future' | 'none';
  text: string;
  group: 'Overdue' | 'Today' | 'Upcoming' | 'No date';
}
function dueInfo(due: string | null | undefined, today: string): DueInfo {
  if (!due) return { state: 'none', text: '', group: 'No date' };
  if (due < today) return { state: 'over', text: `Overdue ${daysBetween(due, today)}d`, group: 'Overdue' };
  if (due === today) return { state: 'due', text: 'Due today', group: 'Today' };
  const ahead = daysBetween(today, due);
  const text = ahead === 1 ? 'Due tomorrow' : ahead < 7 ? `Due ${weekday(due)}` : `Due ${due.slice(5).replace('-', '/')}`;
  return { state: 'future', text, group: 'Upcoming' };
}
function weekday(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

export function TasksView({
  tasks,
  today,
  tz,
  initialView = 'all',
}: {
  tasks: Task[];
  today: string;
  tz: string;
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [dsel, setDsel] = useState<Set<string>>(new Set());
  const [psel, setPsel] = useState<Set<number>>(new Set());
  const [showDone, setShowDone] = useState(false);
  // Live text filter (Wave 2 #3) — narrows rows as you type.
  const [q, setQ] = useState('');

  const toggle = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, v: T) =>
    set((s) => {
      const n = new Set(s);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });

  const active = useMemo(() => tasks.filter((t) => t.status !== 'done'), [tasks]);

  // Subtask visibility (fork, Addendum: subtasks): browse contexts (the
  // No-date group, Project view) hide subtasks — the parent row carries a
  // "▸ done / total" chip and the children live on the parent's detail
  // page. Deadline/state groups (Overdue/Today/Upcoming/Waiting) keep
  // dated or waiting subtasks as their own rows — a deadline is a
  // deadline — wearing a "↳ parent" crumb for context.
  const { childrenByParent, titleById } = useMemo(() => {
    const kids = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.parent_task_id) continue;
      kids.set(t.parent_task_id, [...(kids.get(t.parent_task_id) ?? []), t]);
    }
    return { childrenByParent: kids, titleById: new Map(tasks.map((t) => [t.id, t.title])) };
  }, [tasks]);
  const isSubtask = (t: Task) => t.parent_task_id != null;
  const badgeFor = (t: Task): string | null => {
    const kids = childrenByParent.get(t.id);
    if (!kids?.length) return null;
    const done = kids.filter((k) => k.status === 'done').length;
    return `▸ ${done} / ${kids.length}`;
  };
  const crumbFor = (t: Task): string | null =>
    t.parent_task_id ? (titleById.get(t.parent_task_id) ?? null) : null;
  // Completed TODAY only (app tz) — the API returns all done tasks, so without
  // this the "Completed today" section would list every done task in history.
  const completed = useMemo(
    () => tasks.filter((t) => t.status === 'done' && isToday(tz, t.completed_at ?? null)),
    [tasks, tz],
  );

  // Domain facets — the domains actually present on active tasks, with counts.
  const domainFacets = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const t of active) {
      const id = t.domain_id;
      if (!id) continue;
      const name = t.domain?.name ?? '(domain)';
      const e = m.get(id) ?? { name, count: 0 };
      e.count += 1;
      m.set(id, e);
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [active]);

  const isUpcoming = (t: Task) => t.status === 'open' && !!t.due_date && t.due_date > today;
  const isTodayOrOver = (t: Task) =>
    t.status === 'open' && !!t.due_date && t.due_date <= today;

  // Apply the facets (View + Domain + Priority) and the text narrow to the
  // active list. Text matches title, project/domain name, and waiting-on.
  const visible = useMemo(
    () =>
      active.filter((t) => {
        if (view === 'today' && !isTodayOrOver(t)) return false;
        if (view === 'upcoming' && !isUpcoming(t)) return false;
        if (dsel.size && (!t.domain_id || !dsel.has(t.domain_id))) return false;
        if (psel.size && !psel.has(t.priority)) return false;
        if (q.trim() && !textMatches(q, t.title, t.project?.name, t.domain?.name, t.waiting_on)) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, view, dsel, psel, today, q],
  );

  const groupOf = (t: Task): GroupName =>
    t.status === 'waiting' ? 'Waiting' : dueInfo(t.due_date, today).group;

  const groupsToShow: GroupName[] =
    view === 'today' ? ['Overdue', 'Today'] : view === 'upcoming' ? ['Upcoming'] : [...GROUPS];

  const inGroup = (g: GroupName) =>
    visible
      .filter((t) => groupOf(t) === g)
      // No-date is a browse group — subtasks stay folded under their parent.
      .filter((t) => g !== 'No date' || !isSubtask(t))
      .sort((a, b) =>
        g === 'Waiting'
          ? (a.waiting_since ?? a.created_at).localeCompare(b.waiting_since ?? b.created_at)
          : (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99'),
      );

  // Project view groups by project name instead of by date window.
  // Subtasks fold under their parents here too.
  const byProject = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of visible) {
      if (t.parent_task_id != null) continue;
      const key = t.project?.name ?? `${t.domain?.name ?? 'Domain'} · direct`;
      m.set(key, [...(m.get(key) ?? []), t]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const counts = {
    open: active.filter((t) => t.status === 'open').length,
    overdue: active.filter((t) => t.status === 'open' && t.due_date && t.due_date < today).length,
    waiting: active.filter((t) => t.status === 'waiting').length,
  };
  const activeFilters = dsel.size + psel.size + (view !== 'all' ? 1 : 0) + (q.trim() ? 1 : 0);
  const reset = () => { setView('all'); setDsel(new Set()); setPsel(new Set()); setQ(''); };
  // Project count keys off the SAME name basis byProject groups by, so the rail
  // count always equals the number of rendered project groups.
  const projectKey = (t: Task) => t.project?.name ?? `${t.domain?.name ?? 'Domain'} · direct`;
  const viewCount = (v: View) =>
    v === 'all' ? active.length
      : v === 'today' ? active.filter(isTodayOrOver).length
        : v === 'upcoming' ? active.filter(isUpcoming).length
          : new Set(active.map(projectKey)).size;

  return (
    <div className="lg:flex">
      {/* ─── Facet rail ─────────────────────────────────────────────── */}
      <FacetRail activeCount={activeFilters} onReset={reset}>
        <FacetGroup
          label="View"
          action={
            activeFilters > 0 ? (
              <button type="button" onClick={reset} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">Reset</button>
            ) : undefined
          }
        >
          {VIEWS.map(([k, label]) => (
            <FacetRow key={k} on={view === k} onClick={() => setView(k)} name={label} count={viewCount(k)} />
          ))}
        </FacetGroup>
        <FacetSep />

        {domainFacets.length > 0 && (
          <>
            <FacetGroup
              label="Domain"
              action={
                dsel.size ? (
                  <button type="button" onClick={() => setDsel(new Set())} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">Clear</button>
                ) : undefined
              }
            >
              {domainFacets.map((d) => (
                <FacetRow key={d.id} on={dsel.has(d.id)} onClick={() => toggle(setDsel, d.id)} color={domainColor(d.name)} name={d.name} count={d.count} />
              ))}
            </FacetGroup>
            <FacetSep />
          </>
        )}

        <FacetGroup
          label="Priority"
          action={
            psel.size ? (
              <button type="button" onClick={() => setPsel(new Set())} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">Clear</button>
            ) : undefined
          }
        >
          <FacetTags>
            {[1, 2, 3, 4].map((p) => (
              <FacetTag key={p} on={psel.has(p)} onClick={() => toggle(setPsel, p)} name={`P${p}`} count={active.filter((t) => t.priority === p).length} />
            ))}
          </FacetTags>
        </FacetGroup>
      </FacetRail>

      {/* ─── Body ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 max-w-[840px] px-5 lg:px-0 lg:pl-8 pt-6 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-5">
          <div>
            <div className="eyebrow mb-2">
              {counts.open} open · {counts.overdue} overdue · {counts.waiting} waiting
            </div>
            <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">Tasks</h1>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {/* Fork: recurring-upkeep rotation subview. */}
            <Link
              href="/tasks/maintenance"
              className="font-mono text-[10px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors"
            >
              Maintenance ↻
            </Link>
            <Link
              href="/tasks/new"
              className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded bg-ink border border-ink font-mono text-[10px] uppercase tracking-[0.09em] text-bg hover:bg-ink-2 transition-colors"
            >
              <Icon name="capture" size={14} /> Add task
            </Link>
          </div>
        </div>

        {/* Live filter — type to narrow every group at once. */}
        <div className="mb-5">
          <FilterInput value={q} onChange={setQ} placeholder="Filter tasks, projects, waiting-on…" className="max-w-[420px]" />
        </div>

        {view === 'project' ? (
          byProject.length === 0 ? (
            <EmptyState filtered={activeFilters > 0} />
          ) : (
            byProject.map(([label, ts]) => (
              <TaskGroup key={label} label={label} count={ts.length} tasks={ts} today={today} badgeFor={badgeFor} crumbFor={crumbFor} />
            ))
          )
        ) : (
          <>
            {groupsToShow.map((g) => {
              const ts = inGroup(g);
              if (!ts.length) return null;
              return <TaskGroup key={g} label={g} count={ts.length} tasks={ts} today={today} accent={g === 'Overdue'} badgeFor={badgeFor} crumbFor={crumbFor} />;
            })}
            {visible.length === 0 && <EmptyState filtered={activeFilters > 0} />}
          </>
        )}

        {/* Completed today */}
        {completed.length > 0 && (
          <div className="mt-7 pt-4 border-t border-line-strong">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="flex items-center justify-between w-full"
            >
              <span className="eyebrow">Completed today</span>
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink-3">
                {completed.length}
                <Icon name="chev" size={13} style={{ transform: `rotate(${showDone ? 90 : 0}deg)`, transition: 'transform .15s' }} />
              </span>
            </button>
            {showDone && (
              <div className="mt-2">
                {completed.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 py-2 border-b border-line">
                    <span className="grid place-items-center h-[18px] w-[18px] rounded-full bg-ink border-2 border-ink text-bg shrink-0">
                      <Icon name="check" size={11} strokeWidth={2.8} />
                    </span>
                    <Link href={`/tasks/${t.id}`} className="flex-1 min-w-0 truncate font-sans text-[13.5px] text-ink-3 line-through decoration-ink-4 hover:opacity-80">
                      {t.title}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskGroup({
  label, count, tasks, today, accent, badgeFor, crumbFor,
}: {
  label: string;
  count: number;
  tasks: Task[];
  today: string;
  accent?: boolean;
  badgeFor: (t: Task) => string | null;
  crumbFor: (t: Task) => string | null;
}) {
  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between pb-2 mb-1 border-b border-line">
        <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">{label}</h4>
        <span className={`font-mono text-[11px] ${accent ? 'text-accent' : 'text-ink-3'}`}>{count}</span>
      </div>
      {tasks.map((t) => <TaskRow key={t.id} t={t} today={today} subtaskBadge={badgeFor(t)} parentCrumb={crumbFor(t)} />)}
    </section>
  );
}

function TaskRow({ t, today, subtaskBadge, parentCrumb }: {
  t: Task;
  today: string;
  subtaskBadge?: string | null;
  parentCrumb?: string | null;
}) {
  const isWaiting = t.status === 'waiting';
  const info = dueInfo(t.due_date, today);
  const waitDays = isWaiting && t.waiting_since ? Math.max(0, daysBetween(t.waiting_since, today)) : null;
  const waitStale = waitDays != null && waitDays >= 7;
  const domainName = t.domain?.name ?? null;
  const projectLabel = t.project?.name ?? domainName;

  return (
    <div className="group flex items-start gap-3 py-2.5 border-b border-line/70">
      <form action={toggleTaskDoneAction} className="pt-0.5">
        <input type="hidden" name="taskId" value={t.id} />
        <input type="hidden" name="status" value={t.status} />
        <button
          type="submit"
          aria-label={isWaiting ? 'Mark done' : 'Toggle done'}
          className={`grid place-items-center h-[18px] w-[18px] rounded-full border-2 transition-colors hover:opacity-70 ${
            isWaiting
              ? `border-dashed ${waitStale ? 'border-accent' : 'border-ink-3'}`
              : PRIO_RING[t.priority] ?? 'border-ink-4'
          }`}
        />
      </form>

      <Link href={`/tasks/${t.id}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
        <div className={`font-sans text-[14.5px] leading-snug ${isWaiting ? 'text-ink-2' : 'text-ink'}`}>
          {t.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.05em]">
          {isWaiting ? (
            <span className={waitStale ? 'text-accent' : 'text-ink-3'}>
              ⏸ Waiting{t.waiting_on ? ` on ${t.waiting_on}` : ''}{waitDays != null ? ` · ${waitDays}d` : ''}
            </span>
          ) : (
            info.text && (
              <span className={info.state === 'over' ? 'text-accent' : info.state === 'due' ? 'text-warn' : 'text-ink-3'}>
                {info.text}
              </span>
            )
          )}
          {parentCrumb && (
            <span className="normal-case tracking-normal font-sans text-[11px] text-ink-3 truncate max-w-[220px]">↳ {parentCrumb}</span>
          )}
          {projectLabel && (
            <span className="inline-flex items-center gap-1.5 text-ink-3">
              <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: domainName ? domainColor(domainName) : '#B6AFA4' }} aria-hidden />
              {projectLabel}
            </span>
          )}
          {subtaskBadge && (
            <span className="text-ink-3 border border-line-strong rounded px-1.5 py-0.5">{subtaskBadge}</span>
          )}
          {t.recurrence_rule && isRecurrencePattern(t.recurrence_rule) && (
            <span className="text-ink-3">↻ {t.recurrence_rule}</span>
          )}
          {t.reminder_offsets && t.reminder_offsets.length > 0 && <span className="text-ink-3">remind</span>}
          {t.content_item && <span className="text-accent">linked content</span>}
        </div>
      </Link>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="pt-16 text-center">
      <div className="font-serif text-[25px] font-medium tracking-[-0.015em] text-ink">Nothing in this view.</div>
      <p className="mt-1.5 font-sans text-[14px] text-ink-3">
        {filtered ? 'No task matches these filters.' : 'The list is clear.'}
      </p>
    </div>
  );
}
