import { ScreenHeader } from '@/components/ScreenHeader';
import { AccountChip } from '@/components/AccountChip';
import { TaskItem } from '@/components/TaskItem';
import { AddTaskForm } from './add-task-form';
import { tasksApi, ApiError } from '@/lib/api';
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

  const inbox = open
    .filter((t) => !top3Ids.has(t.id))
    .sort((a, b) => {
      const aDue = a.due_date ?? null;
      const bDue = b.due_date ?? null;
      if (aDue && bDue) return aDue.localeCompare(bDue);
      if (aDue) return -1;
      if (bDue) return 1;
      return b.created_at.localeCompare(a.created_at);
    });

  const doneToday = tasks
    .filter((t) => t.status === 'done' && isToday(t.completed_at ?? null))
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));

  return { top3, inbox, doneToday };
}

export default async function TodayPage() {
  let tasks: Task[] = [];
  let errorMessage: string | null = null;

  try {
    const res = await tasksApi.list();
    tasks = res.tasks;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
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

          <Section label="Up next">
            <EventRow time="—:—" title="No events synced" subtle />
            <Hint>Connect Google Calendar to populate events.</Hint>
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="px-5 lg:px-0 pt-6">
      <div className="eyebrow pb-2 border-b border-line mb-3">{label}</div>
      {children}
    </section>
  );
}

function EventRow({ time, title, subtle }: { time: string; title: string; subtle?: boolean }) {
  return (
    <div className="flex items-baseline gap-4 py-2">
      <span className="font-mono text-[12px] text-ink-3 w-12">{time}</span>
      <span className={`font-sans text-[14px] ${subtle ? 'text-ink-3 italic' : 'text-ink'}`}>
        {title}
      </span>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="font-sans text-[12px] text-ink-3 leading-relaxed mt-1">{children}</p>;
}
