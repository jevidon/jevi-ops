import Link from 'next/link';
import type { Task } from '@jevi-ops/shared';
import {
  RECURRENCE_GLYPH,
  RECURRENCE_LABELS,
  isRecurrencePattern,
} from '@jevi-ops/shared';
import { toggleTaskDoneAction, toggleTop3Action } from '@/app/(authed)/today/actions';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';

// One task row. Two forms (checkbox + star) so each interaction is a single
// POST. Server actions revalidate /today, so the UI refreshes after every
// click without client-side state.
//
// Props
//   - showStar:    render the Top 3 star toggle (default true; off in
//                  "Completed today" and Project detail contexts)
//   - showProject: render the linked project label (default true; off when
//                  the row is already on a project's detail page)

export async function TaskItem({
  task,
  showStar = true,
  showProject = true,
}: {
  task: Task;
  showStar?: boolean;
  showProject?: boolean;
}) {
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);
  const isDone = task.status === 'done';
  const isTop3 = Boolean(task.top3_for_date);
  const dueLabel = task.due_date ? formatDueLabel(task.due_date, today) : null;
  const isOverdue = dueLabel?.kind === 'overdue';
  const isTodayDue = dueLabel?.kind === 'today';
  const project = showProject ? task.project : null;
  // Recurrence indicator. Only render the chip when the rule is a
  // pattern we know how to advance — surface bogus rules silently.
  const recurrence = task.recurrence_rule && isRecurrencePattern(task.recurrence_rule)
    ? task.recurrence_rule
    : null;

  return (
    <div className="flex items-start gap-3 py-2 group">
      <form action={toggleTaskDoneAction} className="pt-0.5">
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="status" value={task.status} />
        <button
          type="submit"
          aria-label={isDone ? 'Mark task open' : 'Mark task done'}
          className={`flex h-5 w-5 items-center justify-center border transition-colors ${
            isDone ? 'border-ink-2 bg-ink-2' : 'border-line hover:border-ink-2'
          }`}
        >
          {isDone && (
            <svg viewBox="0 0 16 16" className="h-3 w-3 text-bg" aria-hidden>
              <path
                d="M3 8l3 3 7-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </form>

      <div className="flex-1 min-w-0">
        <Link
          href={`/tasks/${task.id}`}
          className={`block font-sans text-[14px] leading-snug hover:text-accent transition-colors ${
            isDone ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink'
          }`}
        >
          {task.title}
        </Link>
        {(project || (dueLabel && !isDone) || recurrence) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {project && (
              <Link
                href={`/projects/${project.id}`}
                className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors"
              >
                {project.color && (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color }}
                    aria-hidden
                  />
                )}
                {project.name}
              </Link>
            )}
            {dueLabel && !isDone && (
              <span
                className={`font-mono text-[10px] uppercase tracking-wider ${
                  isOverdue ? 'text-accent' : isTodayDue ? 'text-ink-2' : 'text-ink-3'
                }`}
              >
                {dueLabel.text}
              </span>
            )}
            {recurrence && (
              <span
                className="font-mono text-[10px] uppercase tracking-wider text-ink-3"
                title={`Repeats ${RECURRENCE_LABELS[recurrence].toLowerCase()} — completing this rolls the due date forward instead of marking done.`}
              >
                {RECURRENCE_GLYPH} {RECURRENCE_LABELS[recurrence]}
              </span>
            )}
          </div>
        )}
      </div>

      {showStar && (
        <form action={toggleTop3Action} className="pt-0.5">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="isTop3" value={String(isTop3)} />
          <button
            type="submit"
            aria-label={isTop3 ? 'Remove from Top 3' : 'Add to Top 3'}
            className={`text-[16px] leading-none transition-colors ${
              isTop3 ? 'text-accent' : 'text-ink-3 hover:text-ink-2 opacity-0 group-hover:opacity-100'
            }`}
          >
            {isTop3 ? '★' : '☆'}
          </button>
        </form>
      )}
    </div>
  );
}

// Render a friendly relative due-date label. yyyy-mm-dd → "Due tomorrow",
// "Due Fri Jun 6", "Overdue 3d", etc.
function formatDueLabel(dueIso: string, today: string): { kind: 'overdue' | 'today' | 'future'; text: string } {
  if (dueIso === today) return { kind: 'today', text: 'Due today' };
  if (dueIso < today) {
    const daysPast = daysBetween(dueIso, today);
    return { kind: 'overdue', text: `Overdue ${daysPast}d` };
  }
  const daysAhead = daysBetween(today, dueIso);
  if (daysAhead === 1) return { kind: 'future', text: 'Due tomorrow' };
  if (daysAhead < 7) return { kind: 'future', text: `Due ${weekdayName(dueIso)}` };
  return { kind: 'future', text: `Due ${shortDate(dueIso)}` };
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso + 'T00:00:00Z').getTime();
  const to = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function weekdayName(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short' });
}

function shortDate(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
