import Link from 'next/link';
import type { RoutineListItem, TimeOfDayBucket } from '@/lib/api';
import { recentDaysGrid } from '@jerad-ops/shared';
import { RoutineHeatmap } from '@/components/RoutineHeatmap';
import { toggleCompletionAction } from './actions';

// Daily check-off list — used on /today (compact) and at the top of
// /routines (full). Rows are grouped by time_of_day so the morning row
// of habits clusters together. Inside a bucket we sort by specific_time
// (those with a time first, by hour ascending), then by position.

const BUCKET_LABELS: Record<TimeOfDayBucket, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime',
};

const BUCKET_ORDER: TimeOfDayBucket[] = ['morning', 'afternoon', 'evening', 'anytime'];

function sortRoutines(a: RoutineListItem, b: RoutineListItem): number {
  // Within a bucket: specific_time-ascending (so 6am beats 9am), then
  // position (so the user can manually order within a time block).
  if (a.specific_time && b.specific_time) return a.specific_time.localeCompare(b.specific_time);
  if (a.specific_time) return -1;
  if (b.specific_time) return 1;
  return (a.position ?? 0) - (b.position ?? 0);
}

function formatTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m || !m[1] || !m[2]) return null;
  const h = parseInt(m[1], 10);
  const mn = m[2];
  const period = h < 12 ? 'AM' : 'PM';
  const display = h === 0 ? 12 : h <= 12 ? h : h - 12;
  return `${display}:${mn} ${period}`;
}

export function RoutinesTodayList({
  routines,
  compact = false,
  showInlineHeatmap = false,
  today,
}: {
  routines: RoutineListItem[];
  compact?: boolean;
  // When true (only on /routines), each row gets a 14-day strip on
  // desktop. The /today widget keeps the minimal layout for focus.
  showInlineHeatmap?: boolean;
  // Required when showInlineHeatmap is true — anchors the strip.
  today?: string;
}) {
  if (routines.length === 0) return null;

  // Bucket the rows. Only render buckets that actually have entries —
  // if you have no morning routines, no Morning header.
  const grouped = new Map<TimeOfDayBucket, RoutineListItem[]>();
  for (const r of routines) {
    const bucket = r.time_of_day ?? 'anytime';
    const list = grouped.get(bucket) ?? [];
    list.push(r);
    grouped.set(bucket, list);
  }
  for (const [, list] of grouped) list.sort(sortRoutines);

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      {BUCKET_ORDER.map((bucket) => {
        const list = grouped.get(bucket);
        if (!list || list.length === 0) return null;
        return (
          <div key={bucket}>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mb-1">
              {BUCKET_LABELS[bucket]}
            </div>
            <ul className={compact ? 'space-y-1' : 'space-y-2'}>
              {list.map((r) => (
                <RoutineTodayRow
                  key={r.id}
                  routine={r}
                  compact={compact}
                  showInlineHeatmap={showInlineHeatmap}
                  today={today}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Today's local date in YYYY-MM-DD, in America/Denver. Used to decide
// whether a `last_missed_sent_date` value is "today" for the badge.
function todayIsoInAppTz(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function RoutineTodayRow({
  routine,
  compact,
  showInlineHeatmap,
  today,
}: {
  routine: RoutineListItem;
  compact: boolean;
  showInlineHeatmap?: boolean;
  today?: string;
}) {
  const { stats } = routine;
  const isDone = stats.done_today;
  const timeLabel = formatTime(routine.specific_time);
  // A routine is "currently missed" only if today's cron flagged it AND
  // it still isn't done. Once you check it off the streak still resets
  // (the missed ping already fired) but we stop yelling about it.
  const isMissed = !isDone && routine.last_missed_sent_date === todayIsoInAppTz();
  // 14-day strip on desktop only — keeps the row dense without crowding
  // mobile. Compact mode (used on /today) never shows it.
  const stripGrid = showInlineHeatmap && today && !compact
    ? recentDaysGrid(routine.recent_completions, today, 14)
    : null;

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
        } ${isDone ? 'text-ink-3 line-through decoration-ink-3/60' : isMissed ? 'text-accent' : 'text-ink'} hover:text-accent transition-colors flex items-baseline gap-2`}
      >
        <span className="truncate">{routine.name}</span>
        {isMissed && (
          <span
            className="font-mono text-[10px] uppercase tracking-wider shrink-0 text-accent"
            title="A missed-routine Pushover was sent today and the routine is still unchecked."
          >
            ⚠ missed
          </span>
        )}
        {timeLabel && (
          <span
            className={`font-mono text-[10px] uppercase tracking-wider shrink-0 ${
              isDone ? 'text-ink-3' : isMissed ? 'text-accent/80' : 'text-ink-2'
            }`}
            title={routine.reminder_enabled ? 'Reminder Pushover fires at this time' : undefined}
          >
            {timeLabel}
            {routine.reminder_enabled && <span aria-hidden> · 🔔</span>}
          </span>
        )}
      </Link>
      {stripGrid && (
        <div
          className="hidden lg:flex shrink-0"
          title={`Last 14 days · ${stripGrid.filter((c) => c.done).length}/14 done`}
        >
          <RoutineHeatmap cells={stripGrid} size="sm" layout="row" ariaLabel={`${routine.name} last 14 days`} />
        </div>
      )}
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
