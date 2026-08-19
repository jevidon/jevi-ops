import Link from 'next/link';
import { TaskItem } from '@/components/TaskItem';
import { PanelFrame, PanelLink } from '../PanelFrame';
import type { BriefingContext } from '../registry';

// Doing — the actionable task rail: Top 3 for today, then overdue, then due
// today (capped at 10). The ephemeral Top-3 star lives on the rows.

export function DoingPanel({ ctx }: { ctx: BriefingContext }) {
  const { briefing, railTasks, railOverflow, top3Count } = ctx;
  if (railTasks.length === 0 && (briefing?.doing_today.open_count ?? 0) === 0) return null;
  return (
    <PanelFrame
      eyebrow={
        <>
          Doing
          {briefing && (
            <>
              {' · '}{briefing.doing_today.open_count} open
              {briefing.doing_today.overdue_count > 0 && (
                <span className="text-accent ml-1">· {briefing.doing_today.overdue_count} overdue</span>
              )}
            </>
          )}
        </>
      }
      action={<PanelLink href="/tasks">All tasks →</PanelLink>}
      headerGap="mb-1"
    >
      <div className="mt-1">
        {railTasks.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic py-2">
            No tasks overdue or due today. Star one below to pin it as Top 3.
          </p>
        ) : (
          railTasks.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              parentCrumb={t.parent_task?.title ?? null}
            />
          ))
        )}
        {top3Count < 3 && railTasks.length > 0 && (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {3 - top3Count} Top 3 {3 - top3Count === 1 ? 'slot' : 'slots'} open · tap ☆ on a row to pin
          </p>
        )}
        {railOverflow > 0 && (
          <Link href="/tasks" className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
            + {railOverflow} more →
          </Link>
        )}
      </div>
    </PanelFrame>
  );
}
