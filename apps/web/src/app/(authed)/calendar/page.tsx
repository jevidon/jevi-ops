import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { calendarApi, tasksApi, ApiError, type CalendarEvent } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import type { Task } from '@jevi-ops/shared';

// /calendar — full event list, grouped by day. Tasks with a due_date are
// interleaved into the same day groups so you see "what's happening today"
// in one place (meetings + things to do).

function isoDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function todayIso(tz: string): string {
  return isoDay(new Date().toISOString(), tz);
}

function formatDayHeading(dayIso: string, tz: string): string {
  const today = todayIso(tz);
  if (dayIso === today) return 'Today';

  const dayDate = new Date(dayIso + 'T12:00:00Z');
  const diff = Math.round(
    (new Date(dayIso + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()) /
      (24 * 60 * 60 * 1000),
  );
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) {
    return dayDate.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' });
  }
  return dayDate.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(dayDate.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

function formatEventTime(e: CalendarEvent, tz: string): string {
  if (e.all_day) return 'all day';
  return new Date(e.start_at).toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function CalendarPage() {
  const tz = await getAppTimezone();
  let events: CalendarEvent[] = [];
  let tasks: Task[] = [];
  let errorMessage: string | null = null;

  const [eventsRes, tasksRes] = await Promise.allSettled([
    calendarApi.list(),
    tasksApi.list(),
  ]);
  if (eventsRes.status === 'fulfilled') events = eventsRes.value.events;
  else {
    const err = eventsRes.reason;
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }
  if (tasksRes.status === 'fulfilled') {
    tasks = tasksRes.value.tasks.filter((t) => t.due_date && t.status === 'open');
  }

  // Group events by day in MT.
  const eventGroups = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const day = isoDay(e.start_at, tz);
    if (!eventGroups.has(day)) eventGroups.set(day, []);
    eventGroups.get(day)!.push(e);
  }
  // Group tasks by due_date (already an ISO date string).
  const taskGroups = new Map<string, Task[]>();
  for (const t of tasks) {
    const day = t.due_date!;
    if (!taskGroups.has(day)) taskGroups.set(day, []);
    taskGroups.get(day)!.push(t);
  }

  // Union of all days that have either an event or a task.
  const allDays = Array.from(new Set([...eventGroups.keys(), ...taskGroups.keys()])).sort();

  const today = todayIso(tz);
  const upcomingDays = allDays.filter((d) => d >= today);
  const pastDays = allDays.filter((d) => d < today).reverse();

  const taskCount = tasks.length;

  return (
    <div>
      <ScreenHeader
        eyebrow="Calendar"
        title="All events"
        meta={`±30/+60 days · ${events.length} events · ${taskCount} tasks due`}
      />
      <div className="hairline" />

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          Couldn't load events: {errorMessage}
        </div>
      ) : allDays.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          No events or tasks. Click <strong>Sync now</strong> on{' '}
          <Link className="underline" href="/settings">Settings</Link>{' '}
          to pull from Google.
        </div>
      ) : (
        <>
          {upcomingDays.length > 0 && (
            <div className="px-5 lg:px-0 mt-4">
              {upcomingDays.map((day) => (
                <DayGroup
                  key={day}
                  day={day}
                  events={eventGroups.get(day) ?? []}
                  tasks={taskGroups.get(day) ?? []}
                  tz={tz}
                />
              ))}
            </div>
          )}

          {pastDays.length > 0 && (
            <details className="mx-5 lg:mx-0 mt-8">
              <summary className="eyebrow pb-2 border-b border-line cursor-pointer list-none flex items-center justify-between hover:text-ink-2 transition-colors">
                <span>
                  Past · {pastDays.reduce((sum, d) => sum + (eventGroups.get(d)?.length ?? 0), 0)} events
                </span>
                <span className="font-mono text-[10px] text-ink-3 transition-transform group-open:rotate-90" aria-hidden>▶</span>
              </summary>
              <div className="mt-4">
                {pastDays.map((day) => (
                  <DayGroup
                    key={day}
                    day={day}
                    events={eventGroups.get(day) ?? []}
                    tasks={taskGroups.get(day) ?? []}
                    tz={tz}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function DayGroup({
  day,
  events,
  tasks,
  tz,
}: {
  day: string;
  events: CalendarEvent[];
  tasks: Task[];
  tz: string;
}) {
  return (
    <section className="pt-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 pb-2 border-b border-line mb-3">
        {formatDayHeading(day, tz)}
      </div>
      <ul>
        {events.map((e) => (
          <li key={`e-${e.id}`} className="flex items-start gap-4 py-2.5 border-b border-line/40 last:border-b-0">
            <span className="font-mono text-[12px] text-ink-3 w-16 pt-0.5 tabular-nums shrink-0">
              {formatEventTime(e, tz)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-sans text-[14px] text-ink leading-snug">{e.title}</div>
              {e.location && (
                <div className="font-sans text-[11px] text-ink-3 mt-0.5 truncate">{e.location}</div>
              )}
            </div>
            {e.source === 'created_here' && (
              <span
                className="mt-2 h-1.5 w-1.5 rounded-full bg-accent shrink-0"
                title="Created here"
                aria-hidden
              />
            )}
          </li>
        ))}
        {tasks.map((t) => (
          <TaskOnDay key={`t-${t.id}`} task={t} />
        ))}
      </ul>
    </section>
  );
}

function TaskOnDay({ task }: { task: Task }) {
  const projectColor = task.project?.color ?? null;
  return (
    <li className="flex items-start gap-4 py-2.5 border-b border-line/40 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 w-16 pt-1 shrink-0">
        Task
      </span>
      <div className="flex-1 min-w-0">
        <Link
          href={`/tasks/${task.id}`}
          className="inline-flex items-center gap-2 font-sans text-[14px] text-ink leading-snug hover:text-accent transition-colors"
        >
          {projectColor && (
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: projectColor }}
              aria-hidden
            />
          )}
          <span className="truncate">{task.title}</span>
        </Link>
        {task.project && (
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {task.project.name}
          </div>
        )}
      </div>
    </li>
  );
}
