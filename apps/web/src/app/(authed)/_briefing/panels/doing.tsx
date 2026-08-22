import Link from 'next/link';
import { TaskItem } from '@/components/TaskItem';
import { PanelFrame, PanelLink } from '../PanelFrame';
import type { BriefingContext } from '../registry';

// Doing — the actionable task rail: inbox triage (when anything needs a
// home), then Top 3 for today, overdue, and due today (capped at 10). The
// ephemeral Top-3 star lives on the rows. The triage row moved in from the
// page chrome in Agenda layout v2 — it belongs with the task work, not
// floating above the columns.

export function DoingPanel({ ctx }: { ctx: BriefingContext }) {
  const { briefing, railTasks, railOverflow, top3Count } = ctx;
  const triageCount = briefing?.inbox_triage_count ?? 0;
  if (railTasks.length === 0 && (briefing?.doing_today.open_count ?? 0) === 0 && triageCount === 0)
    return null;
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
        {triageCount > 0 && (
          <Link
            href="/inbox"
            className="flex items-center gap-2 border-l-2 border-accent bg-accent/[0.06] pl-2.5 pr-2 py-1.5 mb-1.5 rounded-r hover:bg-accent/[0.1] transition-colors"
          >
            <span className="font-sans text-[13px] text-ink">
              Inbox · <span className="font-semibold">{triageCount}</span>{' '}
              {triageCount === 1 ? 'needs' : 'need'} a home
            </span>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-accent shrink-0">
              Triage →
            </span>
          </Link>
        )}
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
