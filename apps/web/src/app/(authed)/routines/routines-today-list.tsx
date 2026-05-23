import Link from 'next/link';
import type { RoutineListItem } from '@/lib/api';
import { toggleCompletionAction } from './actions';

// Daily check-off list — used on /today (compact) and at the top of
// /routines (full). Each row: name + 🔥 streak + checkbox. Pure server
// component; clicking the checkbox is a form POST that toggles the
// completion for "today" (server determines what "today" means).

export function RoutinesTodayList({
  routines,
  compact = false,
}: {
  routines: RoutineListItem[];
  compact?: boolean;
}) {
  if (routines.length === 0) return null;

  return (
    <ul className={compact ? 'space-y-1' : 'space-y-2'}>
      {routines.map((r) => (
        <RoutineTodayRow key={r.id} routine={r} compact={compact} />
      ))}
    </ul>
  );
}

function RoutineTodayRow({
  routine,
  compact,
}: {
  routine: RoutineListItem;
  compact: boolean;
}) {
  const { stats } = routine;
  const isDone = stats.done_today;

  return (
    <li className={`flex items-center gap-3 ${compact ? 'py-1' : 'py-2'}`}>
      <form action={toggleCompletionAction} className="shrink-0">
        <input type="hidden" name="routine_id" value={routine.id} />
        <input type="hidden" name="done_today" value={String(isDone)} />
        <button
          type="submit"
          aria-label={isDone ? `Uncheck ${routine.name}` : `Check off ${routine.name}`}
          className={`flex h-5 w-5 items-center justify-center border-2 transition-colors ${
            isDone ? 'bg-ink border-ink text-bg' : 'border-line hover:border-ink-2'
          }`}
        >
          {isDone && (
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </form>
      <Link
        href={`/routines/${routine.id}`}
        className={`flex-1 min-w-0 font-sans ${
          compact ? 'text-[13px]' : 'text-[14px]'
        } ${isDone ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink'} hover:text-accent transition-colors`}
      >
        {routine.name}
      </Link>
      {stats.current_streak > 0 ? (
        <span
          className={`font-mono text-[10px] uppercase tracking-wider shrink-0 ${
            isDone ? 'text-accent' : 'text-ink-3'
          }`}
          title={`Current streak: ${stats.current_streak} days · Longest: ${stats.longest_streak}`}
        >
          🔥 {stats.current_streak}
        </span>
      ) : (
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
          —
        </span>
      )}
    </li>
  );
}
