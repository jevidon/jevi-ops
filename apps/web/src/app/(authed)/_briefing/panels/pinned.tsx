import Link from 'next/link';
import { pinsApi, type ResolvedPin } from '@/lib/api';
import { Pill } from '@/components/Pill';
import { silenceUrgency, silenceLabel } from '@/lib/silence';
import { toggleTaskDoneAction, logCheckInAction } from '../../today/actions';
import { movePinAction, unpinAction } from '../pin-actions';
import { PanelFrame } from '../PanelFrame';
import type { BriefingContext } from '../registry';

// Pinned — anything the user pinned, in their order. Rows come server-
// resolved from GET /api/pins (title/subtitle/href + per-type payload), so
// this panel renders without per-entity fetches. Inline actions where the
// entity has an obvious one: tasks complete in place, companies log a
// check-in, routines show today's done-dot. Reorder is ▲▼ (full-list PATCH
// under the hood), unpin is ×; both hover-revealed on desktop, always
// visible on touch (same convention as the TaskItem star).

const TYPE_LABEL: Record<ResolvedPin['target_type'], string> = {
  task: 'Task',
  project: 'Project',
  domain: 'Domain',
  person: 'Person',
  company: 'Company',
  content_item: 'Content',
  book: 'Book',
  note: 'Note',
  quote: 'Quote',
  routine: 'Routine',
};

export async function PinnedPanel(_props: { ctx: BriefingContext }) {
  let pins: ResolvedPin[] = [];
  try {
    pins = (await pinsApi.list()).pins;
  } catch {
    /* panel degrades to nothing; the rest of the Briefing stands */
  }
  if (pins.length === 0) return null;

  return (
    <PanelFrame eyebrow={<>Pinned · {pins.length}</>} headerGap="mb-1">
      <ul>
        {pins.map((pin, i) => (
          <PinRow key={pin.id} pin={pin} first={i === 0} last={i === pins.length - 1} />
        ))}
      </ul>
    </PanelFrame>
  );
}

function PinRow({ pin, first, last }: { pin: ResolvedPin; first: boolean; last: boolean }) {
  return (
    <li className="group flex items-center gap-3 py-2.5 border-b border-line">
      {pin.task ? (
        <form action={toggleTaskDoneAction} className="shrink-0">
          <input type="hidden" name="taskId" value={pin.target_id} />
          <input type="hidden" name="status" value={pin.task.status} />
          <button
            type="submit"
            aria-label={pin.task.status === 'done' ? 'Reopen task' : 'Complete task'}
            className={`grid place-items-center w-[18px] h-[18px] rounded-[4px] border-[1.5px] transition-colors ${
              pin.task.status === 'done'
                ? 'bg-ink border-ink text-bg'
                : 'border-line-strongest hover:border-ink-2'
            }`}
          >
            {pin.task.status === 'done' && (
              <svg viewBox="0 0 12 12" className="w-[9px] h-[9px] fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 6.5 5 9l5-6" />
              </svg>
            )}
          </button>
        </form>
      ) : pin.routine ? (
        <span
          title={pin.routine.done_today ? 'Done today' : 'Not done yet today'}
          className={`shrink-0 w-[9px] h-[9px] rounded-full ${pin.routine.done_today ? 'bg-good' : 'border-[1.5px] border-line-strongest'}`}
          aria-hidden
        />
      ) : pin.project?.color ? (
        <span className="shrink-0 w-[9px] h-[9px] rounded-[2.5px]" style={{ background: pin.project.color }} aria-hidden />
      ) : null}

      <Link href={pin.href} className="flex-1 min-w-0 group/link">
        <div
          className={`font-sans text-[14px] leading-snug truncate transition-colors group-hover/link:text-accent ${
            pin.task?.status === 'done' ? 'text-ink-3 line-through' : 'text-ink'
          }`}
        >
          {pin.title}
        </div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3 truncate">
          {TYPE_LABEL[pin.target_type]}
          {pin.subtitle ? ` · ${pin.subtitle}` : ''}
        </div>
      </Link>

      {pin.state && <Pill state={pin.state === 'over' ? 'over' : 'due'}>{pin.state === 'over' ? 'Overdue' : 'Due today'}</Pill>}
      {pin.company && pin.company.silent_days != null && (
        <Pill state={silenceUrgency(pin.company.silent_days)}>{silenceLabel(pin.company.silent_days)}</Pill>
      )}
      {pin.company && (
        <form action={logCheckInAction} className="shrink-0 hidden sm:block">
          <input type="hidden" name="company_id" value={pin.target_id} />
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2 border border-line-strong rounded px-2.5 py-1.5 hover:border-ink-3 hover:text-ink transition-colors whitespace-nowrap"
          >
            Log check-in
          </button>
        </form>
      )}

      {/* Row controls — reorder + unpin; quiet until hover on fine pointers. */}
      <span className="shrink-0 flex items-center gap-1 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
        <MoveButton pinId={pin.id} dir="up" disabled={first} />
        <MoveButton pinId={pin.id} dir="down" disabled={last} />
        <form action={unpinAction}>
          <input type="hidden" name="target_type" value={pin.target_type} />
          <input type="hidden" name="target_id" value={pin.target_id} />
          <button
            type="submit"
            title="Unpin"
            aria-label={`Unpin ${pin.title}`}
            className="grid place-items-center w-6 h-6 font-mono text-[12px] leading-none text-ink-3 hover:text-accent transition-colors"
          >
            ×
          </button>
        </form>
      </span>
    </li>
  );
}

function MoveButton({ pinId, dir, disabled }: { pinId: string; dir: 'up' | 'down'; disabled: boolean }) {
  return (
    <form action={movePinAction}>
      <input type="hidden" name="pin_id" value={pinId} />
      <input type="hidden" name="dir" value={dir} />
      <button
        type="submit"
        disabled={disabled}
        title={dir === 'up' ? 'Move up' : 'Move down'}
        aria-label={dir === 'up' ? 'Move pin up' : 'Move pin down'}
        className="grid place-items-center w-6 h-6 font-mono text-[11px] leading-none text-ink-3 hover:text-ink transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        {dir === 'up' ? '↑' : '↓'}
      </button>
    </form>
  );
}
