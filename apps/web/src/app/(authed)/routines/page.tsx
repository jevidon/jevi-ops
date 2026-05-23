import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { routinesApi, ApiError, type RoutineListItem } from '@/lib/api';
import { RoutinesTodayList } from './routines-today-list';
import { reactivateRoutineAction } from './actions';

// /routines — full routines surface. Two regions:
//   1. Today's check-off list (same widget /today shows, no compaction)
//   2. Archived routines (collapsed). Re-activate or hard-delete from here.

export default async function RoutinesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === '1';

  let active: RoutineListItem[] = [];
  let archivedRoutines: RoutineListItem[] = [];
  let today = '';
  let errorMessage: string | null = null;

  try {
    // Always fetch with include_archived=true so we can split into the
    // two sections client-side. One request beats two.
    const res = await routinesApi.list({ include_archived: true });
    today = res.today;
    for (const r of res.routines) {
      if (r.active) active.push(r);
      else archivedRoutines.push(r);
    }
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const totalDone = active.filter((r) => r.stats.done_today).length;
  const todayDisplay = today
    ? new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', {
        timeZone: 'America/Denver',
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
          <RoutinesTodayList routines={active} />
        </div>
      )}

      {/* Archived */}
      {archivedRoutines.length > 0 && (
        <section className="px-5 lg:px-0 pt-10">
          <details open={showArchived}>
            <summary className="eyebrow cursor-pointer list-none hover:text-ink-2 transition-colors pb-2 border-b border-line">
              Archived ({archivedRoutines.length})
            </summary>
            <ul className="mt-3 space-y-2">
              {archivedRoutines.map((r) => (
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
