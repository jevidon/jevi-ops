import type { Task } from '@jerad-ops/shared';
import { toggleTaskDoneAction, toggleTop3Action } from '@/app/(authed)/today/actions';

// One task row. Two forms (checkbox + star) so each interaction is a single
// POST. Server actions revalidate /today, so the UI refreshes after every
// click without client-side state.

export function TaskItem({
  task,
  showStar = true,
}: {
  task: Task;
  showStar?: boolean;
}) {
  const isDone = task.status === 'done';
  const isTop3 = Boolean(task.top3_for_date);

  return (
    <div className="flex items-center gap-3 py-2 group">
      <form action={toggleTaskDoneAction}>
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

      <span
        className={`flex-1 font-sans text-[14px] leading-snug ${
          isDone ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink'
        }`}
      >
        {task.title}
      </span>

      {showStar && (
        <form action={toggleTop3Action}>
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
