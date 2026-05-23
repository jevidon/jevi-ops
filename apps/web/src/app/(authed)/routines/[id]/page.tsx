import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { routinesApi, ApiError, type RoutineDetail } from '@/lib/api';
import { recentDaysGrid } from '@jerad-ops/shared';
import { RoutineForm } from '../routine-form';
import { toggleCompletionAction } from '../actions';

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
  const grid = recentDaysGrid(completions, today, 30);
  const rate30 = stats.completions_30d / 30;
  const rate7 = stats.completions_7d / 7;

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/routines" className="hover:text-ink-2 transition-colors">
          ← Routines
        </Link>
      </div>

      <ScreenHeader
        eyebrow={routine.active ? 'Routine' : 'Routine · Archived'}
        title={routine.name}
        meta={stats.done_today ? '✓ Done today' : 'Not done yet today'}
      />
      <div className="hairline" />

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

        {/* 30-day heatmap */}
        <section className="pt-8">
          <div className="eyebrow pb-2 border-b border-line mb-3">Last 30 days</div>
          <div className="flex flex-wrap gap-1">
            {grid.map((cell) => (
              <div
                key={cell.date}
                title={`${cell.date}${cell.isToday ? ' (today)' : ''} — ${cell.done ? 'done' : 'missed'}`}
                className={`h-5 w-5 border ${
                  cell.done
                    ? 'bg-ink border-ink'
                    : 'border-line bg-transparent'
                } ${cell.isToday ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg' : ''}`}
              />
            ))}
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Filled = done. Outlined = missed. Outlined-and-ringed = today.
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
