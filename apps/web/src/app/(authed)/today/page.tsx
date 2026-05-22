import { ScreenHeader } from '@/components/ScreenHeader';
import { AccountChip } from '@/components/AccountChip';
import { TaskItem } from '@/components/TaskItem';
import { AddTaskForm } from './add-task-form';
import { tasksApi, calendarApi, ApiError, type CalendarEvent } from '@/lib/api';
import { todayIsoDate, isToday } from '@/lib/today';
import type { Task } from '@jerad-ops/shared';

// Today screen — most important UI per spec §4.
//
// Mobile: single column, everything stacks top-to-bottom.
// Desktop (lg+): two-column grid (1.6fr 1fr). Left = focus (Top 3, calendar,
//   all open tasks). Right = ambient (slipping, observation, resurfacing,
//   notifications, completed-today). Section order is the same source-of-
//   truth in both viewports — just rearranged by CSS grid.

function todayLabel() {
  const d = new Date();
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function splitTasks(tasks: Task[]) {
  const today = todayIsoDate();
  const open = tasks.filter((t) => t.status === 'open');

  const top3 = open
    .filter((t) => t.top3_for_date === today)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const top3Ids = new Set(top3.map((t) => t.id));

  // Inbox sort tiers (Todoist/Reminders-style):
  //   1. Overdue (past dates, ascending — oldest first so most-overdue at top)
  //   2. Due today
  //   3. No due date (most recently created first)
  //   4. Future due (ascending — tomorrow first)
  // The motivation: tomorrow's task shouldn't dominate today's view; it
  // sits below the "do whenever" pile so you only see it after dealing
  // with everything immediate.
  const tier = (t: Task): number => {
    if (!t.due_date) return 2;
    if (t.due_date < today) return 0;  // overdue
    if (t.due_date === today) return 1;  // today
    return 3;  // future
  };
  const inbox = open
    .filter((t) => !top3Ids.has(t.id))
    .sort((a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return ta - tb;

      switch (ta) {
        case 0:  // overdue — oldest first
        case 3:  // future — soonest first
          return (a.due_date ?? '').localeCompare(b.due_date ?? '');
        case 1:  // today — most recently created (newest first)
        case 2:  // undated — most recently created
          return b.created_at.localeCompare(a.created_at);
      }
      return 0;
    });

  const doneToday = tasks
    .filter((t) => t.status === 'done' && isToday(t.completed_at ?? null))
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));

  return { top3, inbox, doneToday };
}

export default async function TodayPage() {
  let tasks: Task[] = [];
  let events: CalendarEvent[] = [];
  let errorMessage: string | null = null;

  // Fetch tasks + upcoming events in parallel. Calendar may fail (Google not
  // connected yet), which is non-fatal — task list is the priority.
  const [taskRes, eventRes] = await Promise.allSettled([
    tasksApi.list(),
    calendarApi.upcoming(4),
  ]);
  if (taskRes.status === 'fulfilled') {
    tasks = taskRes.value.tasks;
  } else {
    const err = taskRes.reason;
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }
  if (eventRes.status === 'fulfilled') {
    events = eventRes.value.events;
  }

  const { top3, inbox, doneToday } = splitTasks(tasks);
  const emptySlots = Math.max(0, 3 - top3.length);

  return (
    <div>
      <ScreenHeader eyebrow="Today" title={todayLabel()} meta="Mountain Time" />
      <div className="hairline lg:mb-2" />

      <div className="lg:grid lg:grid-cols-[1.6fr_1fr] lg:gap-x-14">
        {/* ─── Left column — focus ─────────────────────────────────────── */}
        <div>
          <Section label="Top 3 for today">
            {errorMessage ? (
              <Hint>Couldn't load tasks: {errorMessage}</Hint>
            ) : (
              <>
                {top3.map((t) => (
                  <TaskItem key={t.id} task={t} />
                ))}
                {Array.from({ length: emptySlots }).map((_, i) => (
                  <div key={`slot-${i}`} className="flex items-center gap-3 py-2">
                    <span className="h-5 w-5 border border-line" aria-hidden />
                    <span className="font-sans text-[14px] text-ink-3 italic">(open spot)</span>
                  </div>
                ))}
                <Hint>Star a task below to set it as today's top 3.</Hint>
              </>
            )}
          </Section>

          <Section
            label="Up next"
            actionHref={events.length > 0 ? '/calendar' : undefined}
            actionLabel="View all"
          >
            {events.length === 0 ? (
              <>
                <EventRow time="—:—" title="No events" subtle />
                <Hint>Connect Google Calendar in Settings.</Hint>
              </>
            ) : (
              events.map((e) => (
                <EventRow
                  key={e.id}
                  time={formatEventTime(e)}
                  title={e.title}
                  location={e.location}
                  createdHere={e.source === 'created_here'}
                />
              ))
            )}
          </Section>

          <Section label={`All open${inbox.length > 0 ? ` · ${inbox.length}` : ''}`}>
            {errorMessage ? (
              <Hint>Couldn't load tasks.</Hint>
            ) : (
              <>
                {inbox.length === 0 ? (
                  <p className="font-sans text-[13px] text-ink-3 italic py-1">No open tasks.</p>
                ) : (
                  inbox.map((t) => <TaskItem key={t.id} task={t} />)
                )}
                <AddTaskForm />
              </>
            )}
          </Section>
        </div>

        {/* ─── Right column — ambient ──────────────────────────────────── */}
        <div>
          <Section label="Slipping">
            <Hint>Nothing flagged. Domain failure patterns evaluate nightly once data flows.</Hint>
          </Section>

          <Section label="Observation">
            <Hint>No observations yet. Engine runs after Phase 1 cron lands.</Hint>
          </Section>

          <Section label="Resurfacing">
            <Hint>One journal entry, quote, or saved verse rotates here daily.</Hint>
          </Section>

          <Section label="Notifications">
            <Hint>Audit log of autonomous actions appears here.</Hint>
          </Section>

          {doneToday.length > 0 && (
            <section className="px-5 lg:px-0 pt-6">
              <details className="group">
                <summary className="eyebrow pb-2 border-b border-line cursor-pointer list-none flex items-center justify-between hover:text-ink-2 transition-colors">
                  <span>✓ {doneToday.length} done today</span>
                  <span
                    className="font-mono text-[10px] text-ink-3 transition-transform group-open:rotate-90"
                    aria-hidden
                  >
                    ▶
                  </span>
                </summary>
                <div className="mt-3">
                  {doneToday.map((t) => (
                    <TaskItem key={t.id} task={t} showStar={false} />
                  ))}
                  <Hint>Click the checkbox to undo.</Hint>
                </div>
              </details>
            </section>
          )}
        </div>
      </div>

      {/* Mobile-only account footer (desktop puts it in the rail) */}
      <div className="lg:hidden">
        <AccountChip />
      </div>
    </div>
  );
}

function Section({
  label,
  children,
  actionHref,
  actionLabel,
}: {
  label: string;
  children: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <section className="px-5 lg:px-0 pt-6">
      <div className="eyebrow pb-2 border-b border-line mb-3 flex items-center justify-between">
        <span>{label}</span>
        {actionHref && actionLabel && (
          <a
            href={actionHref}
            className="text-ink-3 hover:text-ink-2 normal-case tracking-normal transition-colors"
          >
            {actionLabel} →
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

function EventRow({
  time,
  title,
  location,
  subtle,
  createdHere,
}: {
  time: string;
  title: string;
  location?: string | null;
  subtle?: boolean;
  createdHere?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 py-2">
      <span className="font-mono text-[12px] text-ink-3 w-14 pt-0.5 tabular-nums">{time}</span>
      <div className="flex-1 min-w-0">
        <div className={`font-sans text-[14px] leading-snug ${subtle ? 'text-ink-3 italic' : 'text-ink'}`}>
          {title}
        </div>
        {location && (
          <div className="font-sans text-[11px] text-ink-3 mt-0.5 truncate">{location}</div>
        )}
      </div>
      {createdHere && (
        <span
          className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent shrink-0"
          title="Created here"
          aria-hidden
        />
      )}
    </div>
  );
}

function formatEventTime(e: CalendarEvent): string {
  if (e.all_day) return 'all day';
  const today = todayIsoDate();
  const startDate = new Date(e.start_at);
  const startDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startDate);
  const time = startDate.toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    minute: '2-digit',
  });
  // Show a day prefix for events that aren't today (e.g. "Fri 2:00 PM").
  if (startDay !== today) {
    const day = startDate.toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short' });
    return `${day} ${time}`;
  }
  return time;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="font-sans text-[12px] text-ink-3 leading-relaxed mt-1">{children}</p>;
}
