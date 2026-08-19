import Link from 'next/link';
import { briefingApi, type AgendaPayload, type AgendaTask } from '@/lib/api';
import { toggleTaskDoneAction } from '../../today/actions';
import { PanelFrame, PanelLink } from '../PanelFrame';
import type { BriefingContext } from '../registry';

// Agenda — the unified day timeline: calendar events and tasks due today,
// interleaved by wall-clock time (server-merged, app-tz; a 14:00 task sits
// between the 13:00 and 15:00 meetings). Tasks complete inline; untimed
// tasks collect under "Anytime today". Unlike most panels this one stays
// visible on an empty day — it is the rail's date anchor.

export async function AgendaPanel(_props: { ctx: BriefingContext }) {
  let agenda: AgendaPayload | null = null;
  try {
    agenda = await briefingApi.agenda();
  } catch {
    /* panel degrades to nothing; the rest of the Briefing stands */
  }
  if (!agenda) return null;

  const eventCount = agenda.all_day.length + agenda.timeline.filter((e) => e.kind === 'event').length;
  const taskCount = agenda.timeline.filter((e) => e.kind === 'task').length + agenda.untimed_tasks.length;
  const empty = eventCount === 0 && taskCount === 0;

  return (
    <PanelFrame
      eyebrow={
        <>
          Today
          {eventCount > 0 && <> · {eventCount} {eventCount === 1 ? 'event' : 'events'}</>}
          {taskCount > 0 && <> · {taskCount} {taskCount === 1 ? 'task' : 'tasks'}</>}
        </>
      }
      action={<PanelLink href="/calendar">Open →</PanelLink>}
    >
      {empty ? (
        <p className="font-sans text-[13px] text-ink-3 italic">No events or dated tasks today.</p>
      ) : (
        <>
          {agenda.all_day.map((e) => (
            <Link key={e.id} href="/calendar" className="flex items-baseline gap-4 py-1.5 border-b border-line hover:opacity-80 transition-opacity">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0 w-12">All day</span>
              <span className="font-sans text-[13px] text-ink-2 truncate">{e.title}</span>
            </Link>
          ))}
          {agenda.timeline.map((entry) =>
            entry.kind === 'event' ? (
              <Link key={`e-${entry.id}`} href="/calendar" className="flex items-baseline gap-4 py-1.5 border-b border-line hover:opacity-80 transition-opacity">
                <span className="font-mono text-[12px] text-ink tabular-nums shrink-0 w-12">{entry.time_label}</span>
                <span className="font-sans text-[13px] text-ink-2 truncate">
                  {entry.title}
                  {entry.location && <span className="text-ink-3"> · {entry.location}</span>}
                </span>
              </Link>
            ) : (
              <AgendaTaskRow key={`t-${entry.task.id}`} task={entry.task} timeLabel={entry.time_label} />
            ),
          )}
          {agenda.untimed_tasks.length > 0 && (
            <>
              <div className="mt-2 mb-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">Anytime today</div>
              {agenda.untimed_tasks.map((t) => (
                <AgendaTaskRow key={t.id} task={t} timeLabel={null} />
              ))}
            </>
          )}
        </>
      )}
    </PanelFrame>
  );
}

// Slim task row for the timeline — checkbox + title, not the full TaskItem
// (its star/project/waiting chrome is wrong inside a day schedule).
function AgendaTaskRow({ task, timeLabel }: { task: AgendaTask; timeLabel: string | null }) {
  return (
    <div className="flex items-baseline gap-4 py-1.5 border-b border-line">
      {timeLabel !== null && (
        <span className="font-mono text-[12px] text-ink-3 tabular-nums shrink-0 w-12">{timeLabel}</span>
      )}
      <span className="flex items-center gap-2.5 flex-1 min-w-0">
        <form action={toggleTaskDoneAction} className="shrink-0 self-center">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="status" value={task.status} />
          <button
            type="submit"
            aria-label="Complete task"
            className="grid place-items-center w-[15px] h-[15px] rounded-[3px] border-[1.5px] border-line-strongest hover:border-ink-2 transition-colors"
          />
        </form>
        <Link href={`/tasks/${task.id}`} className="font-sans text-[13px] text-ink truncate hover:text-accent transition-colors">
          {task.title}
          {task.project && <span className="text-ink-3"> · {task.project.name}</span>}
        </Link>
      </span>
    </div>
  );
}
