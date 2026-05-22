import { ScreenHeader } from '@/components/ScreenHeader';
import { AccountChip } from '@/components/AccountChip';
import { TaskItem } from '@/components/TaskItem';
import { AddTaskForm } from './add-task-form';
import { tasksApi, ApiError } from '@/lib/api';
import { todayIsoDate, isToday } from '@/lib/today';
import type { Task } from '@jerad-ops/shared';

// Today screen — most important UI per spec §4. Max 7 elements:
//   1. Calendar slice (next 3-4 events)            ← stub until calendar lands
//   2. Top 3 tasks for today                       ← real
//   3. Domain status (anything slipping)           ← stub until observations cron
//   4. One observation card                        ← stub
//   5. One resurfacing card                        ← stub
//   6. Notification feed entry point               ← stub
//   7. Mic FAB (rendered globally in layout)

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
    .filter((t) => !t.due_date || t.due_date === today)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Tasks finished today — most-recently-completed first, so the latest win
  // is on top when you expand the section.
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
      <div className="hairline" />

      <Section label="Up next">
        <EventRow time="—:—" title="No events synced" subtle />
        <Hint>Connect Google Calendar to populate events.</Hint>
      </Section>

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

      <Section label="Inbox">
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
        <section className="px-5 pt-6">
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

      <AccountChip />
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="px-5 pt-6">
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
