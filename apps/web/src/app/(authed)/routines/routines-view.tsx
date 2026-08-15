'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { RoutineListItem } from '@/lib/api';
import { FacetRail, FacetGroup, FacetRow, FacetSep } from '@/components/FacetRail';
import { toggleCompletionAction, reactivateRoutineAction } from './actions';
import {
  PART_ORDER, PART_LABEL, sortRoutines, formatTime, isMissed,
  buildSummary, monthCellBg, rangeLabel, firstWeekday,
} from './routines-data';

// Routines — daily habits (v2 redesign, Jul 2026). List-first: a facet rail
// (Part of day + Today), a summary band (30-day month block + kept/streak
// stats), then the check-off list grouped Morning/Afternoon/Evening/Anytime.
// Rows carry a streak numeral + chevron, and — per Jerad, against the
// prototype's minimalist row — KEEP the ⚠ missed badge and the time/🔔 bell.
// Detail history lives on /routines/[id]. The /today widget keeps its own
// (RoutinesTodayList) compact list; this view is /routines only.

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function RoutinesView({
  active,
  completed,
  paused,
  today,
  todayLabel,
  tz,
}: {
  active: RoutineListItem[];
  completed: RoutineListItem[];
  paused: RoutineListItem[];
  today: string;
  todayLabel: string;
  tz: string;
}) {
  const [parts, setParts] = useState<Set<string>>(new Set());
  const [state, setState] = useState<'open' | 'done' | null>(null);

  const togPart = (v: string) =>
    setParts((s) => {
      const n = new Set(s);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });

  const doneCount = active.filter((r) => r.stats.done_today).length;
  const summary = useMemo(() => buildSummary(active, today), [active, today]);

  const visible = active.filter((r) => {
    const bucket = r.time_of_day ?? 'anytime';
    if (parts.size && !parts.has(bucket)) return false;
    if (state === 'done' && !r.stats.done_today) return false;
    if (state === 'open' && r.stats.done_today) return false;
    return true;
  });

  const activeFilters = parts.size + (state ? 1 : 0);
  const reset = () => { setParts(new Set()); setState(null); };

  return (
    <div className="lg:flex">
      <FacetRail activeCount={activeFilters} onReset={reset}>
        <FacetGroup label="Part of day" action={activeFilters > 0 ? <ClearBtn onClick={reset} label="Reset" /> : undefined}>
          {PART_ORDER.map((p) => {
            const n = active.filter((r) => (r.time_of_day ?? 'anytime') === p).length;
            return n ? <FacetRow key={p} on={parts.has(p)} onClick={() => togPart(p)} name={PART_LABEL[p]} count={n} /> : null;
          })}
        </FacetGroup>
        <FacetSep />
        <FacetGroup label="Today">
          <FacetRow on={state === 'open'} onClick={() => setState((s) => (s === 'open' ? null : 'open'))} name="Remaining" count={active.length - doneCount} />
          <FacetRow on={state === 'done'} onClick={() => setState((s) => (s === 'done' ? null : 'done'))} name="Done" count={doneCount} />
        </FacetGroup>
      </FacetRail>

      <div className="flex-1 min-w-0 px-5 lg:px-0 lg:pl-8 pt-6 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-5">
          <div>
            <div className="eyebrow mb-2">
              Routines · {doneCount}/{active.length} today{todayLabel ? ` · ${todayLabel}` : ''}
            </div>
            <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">Daily habits</h1>
          </div>
          <Link href="/routines/new" className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded bg-ink border border-ink font-mono text-[10px] uppercase tracking-[0.09em] text-bg hover:bg-ink-2 transition-colors shrink-0">
            + Add routine
          </Link>
        </div>

        {active.length > 0 && <SummaryBand summary={summary} />}

        {active.length === 0 ? (
          <div className="pt-14 font-sans text-[13.5px] text-ink-3 italic max-w-xl">
            No routines yet. Tap <span className="font-mono not-italic">+ Add routine</span> to start tracking things
            like &ldquo;read the Bible&rdquo;, &ldquo;take meds&rdquo;, or &ldquo;check email&rdquo;. Daily reset is
            automatic — your streak builds with each consecutive day.
          </div>
        ) : (
          <>
            {PART_ORDER.map((part) => {
              const rows = visible.filter((r) => (r.time_of_day ?? 'anytime') === part).sort(sortRoutines);
              if (!rows.length) return null;
              // Header progress reflects the part's TRUE done/total, counted over
              // the full active set — not the Today-filtered `rows`, which would
              // read a degenerate "0/2" under the Remaining facet.
              const partAll = active.filter((r) => (r.time_of_day ?? 'anytime') === part);
              const partDone = partAll.filter((r) => r.stats.done_today).length;
              return (
                <section key={part} className="mt-7 first:mt-6">
                  <div className="flex items-baseline justify-between gap-3 pb-2 mb-1 border-b border-line">
                    <h4 className="font-serif text-[15px] font-medium tracking-[-0.01em] text-ink">{PART_LABEL[part]}</h4>
                    <span className="font-mono text-[11px] text-ink-3">{partDone}/{partAll.length}</span>
                  </div>
                  <ul>
                    {rows.map((r) => (
                      <RoutineRow key={r.id} r={r} today={today} />
                    ))}
                  </ul>
                </section>
              );
            })}

            {visible.length === 0 && (
              <div className="pt-14 text-center">
                <div className="font-serif text-[25px] font-medium tracking-[-0.015em] text-ink">Nothing in this view.</div>
                <p className="mt-1.5 font-sans text-[14px] text-ink-3">Clear a filter on the left.</p>
              </div>
            )}
          </>
        )}

        {completed.length > 0 && (
          <details className="mt-10">
            <summary className="eyebrow cursor-pointer list-none hover:text-ink-2 transition-colors pb-2 border-b border-line">
              Completed ({completed.length})
            </summary>
            <ul>
              {completed.map((r) => (
                <ArchivedRow key={r.id} r={r} tz={tz} completed />
              ))}
            </ul>
          </details>
        )}

        {paused.length > 0 && (
          <details className="mt-8">
            <summary className="eyebrow cursor-pointer list-none hover:text-ink-2 transition-colors pb-2 border-b border-line">
              Paused ({paused.length})
            </summary>
            <ul>
              {paused.map((r) => (
                <ArchivedRow key={r.id} r={r} tz={tz} completed={false} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function SummaryBand({ summary }: { summary: ReturnType<typeof buildSummary> }) {
  const { daily, rate30, rate7, bestStreak } = summary;
  const pad = firstWeekday(daily);
  return (
    <div className="flex flex-wrap items-center gap-x-9 gap-y-4 py-4 border-b border-line">
      {/* 30-day month block, weekday-aligned; darker = more kept */}
      <div className="shrink-0">
        <div className="grid grid-cols-7 gap-[3px]" style={{ width: 'max-content' }}>
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="w-[13px] text-center font-mono text-[8px] text-ink-4 leading-none">{w}</span>
          ))}
          {Array.from({ length: pad }, (_, i) => (
            <span key={`pad-${i}`} className="w-[13px] h-[13px]" aria-hidden />
          ))}
          {daily.map((c, i) => (
            <span
              key={c.date}
              title={`${c.date} — ${c.done} of ${c.eligible} kept`}
              className={`w-[13px] h-[13px] rounded-[2px] ${i === daily.length - 1 ? 'ring-1 ring-accent ring-offset-1 ring-offset-bg' : ''}`}
              style={{ background: monthCellBg(c.rate) }}
            />
          ))}
        </div>
        <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4">{rangeLabel(daily)} · darker is more kept</div>
      </div>

      {/* Derived stats */}
      <div className="flex gap-8">
        <Stat value={`${Math.round(rate30 * 100)}%`} label="Kept · 30d" />
        <Stat value={`${Math.round(rate7 * 100)}%`} label="Last 7" />
        <Stat
          value={String(bestStreak.streak)}
          valueClass={bestStreak.streak ? 'text-accent' : 'text-ink-4'}
          label={bestStreak.streak ? `Day streak · ${bestStreak.name}` : 'Day streak'}
        />
      </div>
    </div>
  );
}

function Stat({ value, label, valueClass = 'text-ink' }: { value: string; label: string; valueClass?: string }) {
  return (
    <div>
      <div className={`font-serif text-[27px] leading-none ${valueClass}`}>{value}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 max-w-[140px] truncate">{label}</div>
    </div>
  );
}

function RoutineRow({ r, today }: { r: RoutineListItem; today: string }) {
  const isDone = r.stats.done_today;
  const missed = isMissed(r, today);
  const timeLabel = formatTime(r.specific_time);
  const streak = r.stats.current_streak;

  return (
    <li className="flex items-center gap-3 py-2 border-b border-line/50">
      <form action={toggleCompletionAction} className="shrink-0">
        <input type="hidden" name="routine_id" value={r.id} />
        <input type="hidden" name="done_today" value={String(isDone)} />
        <button
          type="submit"
          aria-label={isDone ? `Uncheck ${r.name}` : `Check off ${r.name}`}
          className={`flex h-5 w-5 items-center justify-center rounded-[5px] border-2 transition-colors ${
            isDone ? 'bg-ink border-ink text-bg' : 'border-line-strong hover:border-ink-2'
          }`}
        >
          {isDone && (
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.8">
              <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </form>

      <Link href={`/routines/${r.id}`} className="flex-1 min-w-0 flex items-center gap-2.5 group">
        <span className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className={`truncate font-sans text-[14px] ${isDone ? 'text-ink-3 line-through decoration-ink-4' : missed ? 'text-accent' : 'text-ink group-hover:text-accent'} transition-colors`}>
            {r.name}
          </span>
          {missed && (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-accent" title="A missed-routine Pushover was sent today and it's still unchecked.">
              ⚠ missed
            </span>
          )}
          {timeLabel && (
            <span
              className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] ${isDone ? 'text-ink-3' : missed ? 'text-accent/80' : 'text-ink-2'}`}
              title={r.reminder_enabled ? 'Reminder Pushover fires at this time' : undefined}
            >
              {timeLabel}
              {r.reminder_enabled && <span aria-hidden> · 🔔</span>}
            </span>
          )}
        </span>
        <span className="shrink-0 flex items-baseline gap-1 font-mono text-[10px] uppercase tracking-[0.08em]">
          <b className={streak ? 'text-ink' : 'text-ink-4'}>{streak}</b>
          <span className="text-ink-3">{streak === 1 ? 'day' : 'days'}</span>
        </span>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-ink-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}

function ArchivedRow({ r, tz, completed }: { r: RoutineListItem; tz: string; completed: boolean }) {
  const archivedDate = completed && r.archived_at
    ? new Date(r.archived_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const streakLine = r.stats.longest_streak > 0 ? `Longest streak: ${r.stats.longest_streak} · ${r.stats.total} total` : null;
  const meta = [archivedDate ? `Archived ${archivedDate}` : null, streakLine].filter(Boolean).join(' · ');
  return (
    <li className="flex items-start justify-between gap-3 py-[11px] border-b border-line">
      <div className="flex-1 min-w-0">
        <Link href={`/routines/${r.id}`} className="block font-sans text-[14px] text-ink-2 hover:text-ink transition-colors">
          {r.name}
          {completed && r.goal_days && (
            <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">✓ {r.goal_days}d goal</span>
          )}
        </Link>
        {meta && <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">{meta}</div>}
      </div>
      <form action={reactivateRoutineAction} className="shrink-0">
        <input type="hidden" name="id" value={r.id} />
        <button type="submit" className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-accent transition-colors">
          Reactivate
        </button>
      </form>
    </li>
  );
}

function ClearBtn({ onClick, label = 'Clear' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">
      {label}
    </button>
  );
}
