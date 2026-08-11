import type { Task } from '@jevi-ops/shared';
import { TaskItem } from '@/components/TaskItem';
import { createSubtaskAction } from './actions';

// Subtasks ledger on a task's detail page. Open children render with
// live checkboxes (same TaskItem as everywhere else), the quick-add row
// creates a child pre-linked to this parent's project/domain, and done
// children fold away. Hierarchy is one level deep: this section only
// renders for tasks that aren't subtasks themselves.
export function SubtasksSection({ parent, subtasks }: { parent: Task; subtasks: Task[] }) {
  const open = subtasks
    .filter((t) => t.status === 'open')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const done = subtasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));

  return (
    <section>
      <div className="eyebrow pb-2 border-b border-line flex items-baseline justify-between">
        <span>Subtasks</span>
        {subtasks.length > 0 && (
          <span className="font-mono text-[10px] tracking-wider text-ink-3">
            {done.length} / {subtasks.length}
          </span>
        )}
      </div>

      <div className="mt-1">
        {open.map((t) => (
          <TaskItem key={t.id} task={t} showStar={false} showProject={false} />
        ))}
        {open.length === 0 && done.length > 0 && (
          <p className="font-sans text-[13px] text-ink-3 italic py-2">All subtasks done.</p>
        )}
      </div>

      <form action={createSubtaskAction} className="flex items-center gap-3 py-2">
        <span className="h-5 w-5 border border-dashed border-line-strong shrink-0" aria-hidden />
        <input type="hidden" name="parentId" value={parent.id} />
        {parent.project_id ? (
          <input type="hidden" name="projectId" value={parent.project_id} />
        ) : (
          <input type="hidden" name="domainId" value={parent.domain_id} />
        )}
        <input
          type="text"
          name="title"
          required
          placeholder="Add subtask…"
          autoComplete="off"
          aria-label="Add subtask"
          className="flex-1 min-w-0 bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1 font-sans text-[14px] text-ink placeholder:text-ink-4"
        />
      </form>

      {done.length > 0 && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors flex items-center gap-2">
            <span className="transition-transform group-open:rotate-90" aria-hidden>
              ▶
            </span>
            Done · {done.length}
          </summary>
          <div className="mt-1">
            {done.map((t) => (
              <TaskItem key={t.id} task={t} showStar={false} showProject={false} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
