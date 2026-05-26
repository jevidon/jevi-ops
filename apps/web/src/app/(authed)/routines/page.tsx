import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { routinesApi, ApiError, type RoutineListItem } from '@/lib/api';
import { recentDaysGrid } from '@jerad-ops/shared';
import { RoutinesTodayList } from './routines-today-list';
import { reactivateRoutineAction } from './actions';
import { RoutineHeatmap } from '@/components/RoutineHeatmap';
import { RoutinesAnalytics } from './routines-analytics';
import { getAppTimezone } from '@/lib/app-settings';

// /routines — full routines surface. Three regions:
//   1. Today's check-off list (same widget /today shows, no compaction)
//   2. Completed (collapsed) — goal hit OR manually archived after archived_at
//      was added. Sorted by archived_at desc.
//   3. Paused (collapsed) — manually deactivated but no goal completion.
//      Older archive paths leave archived_at null, so we keep "paused"
//      separate to avoid retroactively reframing them as "completed".

export default async function RoutinesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === '1';
  const tz = await getAppTimezone();

  const active: RoutineListItem[] = [];
  const completed: RoutineListItem[] = [];
  const paused: RoutineListItem[] = [];
  let today = '';
  let errorMessage: string | null = null;

  try {
    // Always fetch with include_archived=true so we can split into the
    // sections client-side. One request beats two.
    const res = await routinesApi.list({ include_archived: true });
    today = res.today;
    for (const r of res.routines) {
      if (r.active) active.push(r);
      else if (r.archived_at) completed.push(r);
      else paused.push(r);
    }
    // Newest archives first — same convention as a "history" timeline.
    completed.sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? ''));
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const totalDone = active.filter((r) => r.stats.done_today).length;
  const todayDisplay = today
    ? new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', {
        timeZone: tz,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })
    : '';

  return (
    <div>
      <ScreenHeader
        eyebrow="Routines"
        title="Daily habits"
        meta={
          active.length > 0
            ? `${totalDone}/${active.length} today · ${todayDisplay}`
            : todayDisplay
        }
      />
      <div className="hairline" />

      {/* Overall analytics — only when there are active routines to summarize. */}
      {active.length > 0 && <RoutinesAnalytics routines={active} today={today} />}

      <div className="px-5 lg:px-0 pt-4 flex items-center justify-between">
        <div className="eyebrow">Today</div>
        <Link
          href="/routines/new"
          className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          + Add routine
        </Link>
      </div>

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-4 font-sans text-[13px] text-accent">{errorMessage}</div>
      ) : active.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          No routines yet. Tap <span className="font-mono">+ Add routine</span> to start tracking
          things like &ldquo;read the Bible&rdquo;, &ldquo;take meds&rdquo;, or
          &ldquo;check email&rdquo;. Daily reset is automatic — your streak builds with each
          consecutive day.
        </div>
      ) : (
        <div className="px-5 lg:px-0 mt-3">
          <RoutinesTodayList routines={active} showInlineHeatmap today={today} />
        </div>
      )}

      {/* Completed — goals hit (or manually archived since archived_at landed) */}
      {completed.length > 0 && (
        <section className="px-5 lg:px-0 pt-10">
          <details open={showArchived}>
            <summary className="eyebrow cursor-pointer list-none hover:text-ink-2 transition-colors pb-2 border-b border-line">
              Completed ({completed.length})
            </summary>
            <ul className="mt-3 space-y-2">
              {completed.map((r) => (
                <CompletedRow key={r.id} r={r} today={today} tz={tz} />
              ))}
            </ul>
          </details>
        </section>
      )}

      {/* Paused — older archives without an archived_at timestamp */}
      {paused.length > 0 && (
        <section className="px-5 lg:px-0 pt-10">
          <details>
            <summary className="eyebrow cursor-pointer list-none hover:text-ink-2 transition-colors pb-2 border-b border-line">
              Paused ({paused.length})
            </summary>
            <ul className="mt-3 space-y-2">
              {paused.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3 py-2 border-b border-line/40">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/routines/${r.id}`}
                      className="block font-sans text-[14px] text-ink-2 hover:text-ink transition-colors"
                    >
                      {r.name}
                    </Link>
                    {r.stats.longest_streak > 0 && (
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                        Longest streak: {r.stats.longest_streak} · {r.stats.total} total
                      </div>
                    )}
                  </div>
                  <form action={reactivateRoutineAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
                    >
                      Reactivate
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}

function CompletedRow({ r, today, tz }: { r: RoutineListItem; today: string; tz: string }) {
  const archivedDate = r.archived_at
    ? new Date(r.archived_at).toLocaleDateString('en-US', {
        timeZone: tz,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;
  // Mini-heatmap anchored at the archive date when available — shows
  // the run that earned the trophy. Falls back to today for older
  // archives missing archived_at. 28 days = 4 weeks, fits the row.
  const heatmapAnchor = r.archived_at?.slice(0, 10) ?? today;
  const grid = recentDaysGrid(r.recent_completions, heatmapAnchor, 28);

  return (
    <li className="flex items-start justify-between gap-3 py-2 border-b border-line/40">
      <div className="flex-1 min-w-0">
        <Link
          href={`/routines/${r.id}`}
          className="block font-sans text-[14px] text-ink-2 hover:text-ink transition-colors"
        >
          {r.name}
          {r.goal_days && (
            <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-accent">
              ✓ {r.goal_days}d goal
            </span>
          )}
        </Link>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {archivedDate ? `Archived ${archivedDate}` : null}
          {archivedDate && r.stats.longest_streak > 0 ? ' · ' : null}
          {r.stats.longest_streak > 0
            ? `Longest streak: ${r.stats.longest_streak} · ${r.stats.total} total`
            : null}
        </div>
      </div>
      <div className="shrink-0 hidden sm:block">
        <RoutineHeatmap cells={grid} size="sm" ariaLabel={`${r.name} recent 28 days`} />
      </div>
      <form action={reactivateRoutineAction} className="shrink-0">
        <input type="hidden" name="id" value={r.id} />
        <button
          type="submit"
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          Reactivate
        </button>
      </form>
    </li>
  );
}
