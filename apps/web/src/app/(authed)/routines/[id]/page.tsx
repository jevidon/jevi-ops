import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { routinesApi, ApiError, type RoutineDetail } from '@/lib/api';
import { recentDaysGrid } from '@jerad-ops/shared';
import { RoutineForm } from '../routine-form';
import { toggleCompletionAction } from '../actions';
import { RoutineHeatmap } from '@/components/RoutineHeatmap';
import { Pill } from '@/components/Pill';
import { PART_LABEL } from '../routines-data';

// /routines/[id] — single routine view. Lifetime stats at the top, a
// 30-day heatmap, then the edit/archive/delete form collapsed below.

export default async function RoutineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: RoutineDetail | null = null;
  let errorMessage: string | null = null;
  try {
    detail = await routinesApi.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!detail) {
    return (
      <div>
        <ScreenHeader eyebrow="Routine" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Routine not found.'}
        </div>
      </div>
    );
  }

  const { routine, completions, stats, today } = detail;
  const rate30 = stats.completions_30d / 30;
  const rate7 = stats.completions_7d / 7;

  // Heatmap window selection:
  //   - Active routine: 90 days back from today (so you see the recent
  //     stretch, not just this month).
  //   - Archived routine WITH a goal: window = goal_days, anchored at
  //     the archive date. Shows the run that earned the trophy.
  //   - Archived routine WITHOUT a goal: 90 days ending at archive date.
  let heatmapAnchor = today;
  let heatmapDays = 90;
  if (routine.archived_at) {
    heatmapAnchor = routine.archived_at.slice(0, 10);
    if (routine.goal_days) heatmapDays = routine.goal_days;
  }
  const grid = recentDaysGrid(completions, heatmapAnchor, heatmapDays);
  const heatmapLabel = routine.archived_at
    ? routine.goal_days
      ? `Goal period (${routine.goal_days} days through ${heatmapAnchor})`
      : `Last 90 days through ${heatmapAnchor}`
    : 'Last 90 days';

  // Goal progress (only meaningful for active routines with a goal set).
  const goalProgress =
    routine.active && routine.goal_days
      ? Math.min(stats.current_streak / routine.goal_days, 1)
      : null;

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/routines" className="hover:text-ink-2 transition-colors">
          ← Routines
        </Link>
      </div>

      <div className="px-5 lg:px-0 pt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="eyebrow mb-2">
            {routine.active ? `Routine · ${PART_LABEL[routine.time_of_day]}` : 'Routine · Archived'}
          </div>
          <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">{routine.name}</h1>
        </div>
        {routine.active && (
          <div className="pb-1">
            <Pill state={stats.done_today ? 'ok' : 'due'}>{stats.done_today ? 'Done today' : 'Not done yet today'}</Pill>
          </div>
        )}
      </div>
      <div className="hairline mt-4" />

      {routine.description && (
        <div className="px-5 lg:px-0 mt-4 max-w-2xl">
          <div className="font-sans text-[14px] text-ink-2 leading-relaxed whitespace-pre-wrap">
            {routine.description}
          </div>
        </div>
      )}

      <div className="px-5 lg:px-0 max-w-2xl">
        {/* One-tap toggle for today */}
        {routine.active && (
          <div className="mt-6">
            <form action={toggleCompletionAction} className="flex items-center gap-3">
              <input type="hidden" name="routine_id" value={routine.id} />
              <input type="hidden" name="done_today" value={String(stats.done_today)} />
              <button
                type="submit"
                className={`flex h-8 w-8 items-center justify-center border-2 transition-colors ${
                  stats.done_today ? 'bg-ink border-ink text-bg' : 'border-line hover:border-ink-2'
                }`}
                aria-label={stats.done_today ? 'Uncheck today' : 'Check off today'}
              >
                {stats.done_today && (
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <span className="font-sans text-[14px] text-ink">
                {stats.done_today ? 'Done today' : 'Mark done for today'}
              </span>
            </form>
          </div>
        )}

        {/* Lifetime stat grid */}
        <section className="pt-8">
          <div className="eyebrow pb-2 border-b border-line mb-3">Stats</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4">
            <Stat label="Current streak" value={`${stats.current_streak}d`} accent={stats.current_streak > 0} />
            <Stat label="Longest streak" value={`${stats.longest_streak}d`} />
            <Stat label="7-day rate" value={`${Math.round(rate7 * 100)}%`} />
            <Stat label="30-day rate" value={`${Math.round(rate30 * 100)}%`} />
          </div>
          <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {stats.total} total {stats.total === 1 ? 'completion' : 'completions'}
          </div>
        </section>

        {/* Goal progress — only when active AND a goal is set. */}
        {goalProgress != null && routine.goal_days && (
          <section className="pt-8">
            <div className="eyebrow pb-2 border-b border-line mb-3">Goal progress</div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-serif text-[24px] text-ink leading-none">
                {stats.current_streak}
                <span className="text-ink-3 text-[16px]"> / {routine.goal_days} days</span>
              </span>
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
                {Math.round(goalProgress * 100)}%
              </span>
            </div>
            <div className="h-2 bg-line/40 overflow-hidden">
              <div
                className="h-full bg-ink transition-all"
                style={{ width: `${Math.round(goalProgress * 100)}%` }}
              />
            </div>
            {stats.current_streak === 0 && (
              <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                Streak reset. Mark today done to start counting toward the goal again.
              </div>
            )}
          </section>
        )}

        {/* Heatmap — week columns × weekday rows, GitHub-contributions style. */}
        <section className="pt-8">
          <div className="eyebrow pb-2 border-b border-line mb-3">{heatmapLabel}</div>
          <div className="overflow-x-auto">
            <RoutineHeatmap cells={grid} size="lg" ariaLabel={`${routine.name} completion heatmap`} />
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Filled = done. Outlined = missed. Sun is top, Sat is bottom.
          </div>
        </section>

        {/* Edit / archive / delete */}
        <section className="mt-12">
          <details className="border border-line">
            <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors list-none">
              Edit routine ▾
            </summary>
            <div className="px-4 pb-4 pt-3 border-t border-line">
              <RoutineForm
                initial={{
                  id: routine.id,
                  name: routine.name,
                  description: routine.description ?? '',
                  time_of_day: routine.time_of_day,
                  // <input type="time"> wants HH:MM. specific_time from
                  // Postgres may include seconds — strip them.
                  specific_time: routine.specific_time?.slice(0, 5) ?? '',
                  reminder_enabled: routine.reminder_enabled,
                  goal_days: routine.goal_days,
                }}
              />
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className={`font-serif text-[28px] leading-none ${accent ? 'text-accent' : 'text-ink'}`}>
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        {label}
      </div>
    </div>
  );
}
