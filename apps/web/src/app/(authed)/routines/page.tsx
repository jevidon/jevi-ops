import { routinesApi, ApiError, type RoutineListItem } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { RoutinesView } from './routines-view';

// /routines — daily-habits surface (v2 redesign). Thin server shell: fetch the
// routines (active + archived in one call), split into active / completed
// (goal hit or manually archived, archived_at set) / paused (older archives
// with no timestamp), hand off to the client RoutinesView which owns the facet
// rail, summary band, and check-off list. The /today widget keeps its own
// compact list — this rebuild is /routines only.

export const dynamic = 'force-dynamic';

export default async function RoutinesPage() {
  const tz = await getAppTimezone();

  const active: RoutineListItem[] = [];
  const completed: RoutineListItem[] = [];
  const paused: RoutineListItem[] = [];
  let today = '';
  let errorMessage: string | null = null;

  try {
    const res = await routinesApi.list({ include_archived: true });
    today = res.today;
    for (const r of res.routines) {
      if (r.active) active.push(r);
      else if (r.archived_at) completed.push(r);
      else paused.push(r);
    }
    completed.sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? ''));
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (errorMessage) {
    return (
      <div className="px-5 lg:px-10 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">Daily habits</h1>
        <p className="mt-4 font-sans text-[13px] text-accent">{errorMessage}</p>
      </div>
    );
  }

  const todayLabel = today
    ? new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', {
        timeZone: tz,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })
    : '';

  return (
    <RoutinesView
      active={active}
      completed={completed}
      paused={paused}
      today={today}
      todayLabel={todayLabel}
      tz={tz}
    />
  );
}
