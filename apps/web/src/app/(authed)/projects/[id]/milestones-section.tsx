import type { Milestone } from '@/lib/api';
import {
  addMilestoneAction,
  toggleMilestoneAction,
  updateMilestoneAction,
  deleteMilestoneAction,
} from './milestone-actions';

// Server component — renders the milestones list with inline edit + check-
// off + delete forms, and an "add milestone" row at the bottom. Each row
// is its own little form; toggling is a one-tap button. Edit lives behind
// a <details> per row to keep the list scannable.

export function MilestonesSection({
  projectId,
  milestones,
}: {
  projectId: string;
  milestones: Milestone[];
}) {
  const progressPct = computeProgressPct(milestones);
  const label = milestones.length === 0
    ? 'Milestones'
    : `Milestones · ${progressPct}%`;

  return (
    <section className="px-5 lg:px-0 pt-6">
      <div className="eyebrow pb-2 border-b border-line mb-3">{label}</div>

      {milestones.length === 0 ? (
        <p className="font-sans text-[13px] text-ink-3 italic py-1 mb-3">
          No milestones yet. Add weighted checkpoints to track project progress.
        </p>
      ) : (
        <ul className="mb-3">
          {milestones.map((m) => (
            <MilestoneRow key={m.id} projectId={projectId} milestone={m} />
          ))}
        </ul>
      )}

      {/* Add-milestone form. Stays visible at the bottom of the list so
          adding more is always one tap away. Weight defaults to 1; the
          input is exposed for the rare case where a milestone is bigger
          than the others (a 3× rough cut, e.g.). */}
      <form action={addMilestoneAction} className="flex items-center gap-2 mt-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input
          type="text"
          name="title"
          required
          placeholder="+ Add milestone…"
          className="flex-1 bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-3"
        />
        <input
          type="number"
          name="weight"
          defaultValue={1}
          min={1}
          step={1}
          aria-label="Weight"
          title="Weight (rolls up into project % complete)"
          className="w-12 bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-mono text-[12px] text-ink text-center"
        />
        <button
          type="submit"
          className="px-2.5 py-1 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors"
        >
          Add
        </button>
      </form>
    </section>
  );
}

function MilestoneRow({ projectId, milestone }: { projectId: string; milestone: Milestone }) {
  const isDone = milestone.status === 'done';
  const nextStatus = isDone ? 'open' : 'done';

  return (
    <li className="border-b border-line/40 last:border-b-0">
      <div className="flex items-start gap-3 py-2.5">
        {/* Toggle checkbox. Wrapped in its own <form> so clicking flips
            the status server-side without affecting the edit form below. */}
        <form action={toggleMilestoneAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="milestone_id" value={milestone.id} />
          <input type="hidden" name="next_status" value={nextStatus} />
          <button
            type="submit"
            aria-label={isDone ? 'Reopen milestone' : 'Mark milestone done'}
            className={`mt-0.5 flex h-5 w-5 items-center justify-center border transition-colors ${
              isDone
                ? 'border-ink-2 bg-ink-2 hover:bg-ink'
                : 'border-line hover:border-ink-2'
            }`}
          >
            {isDone && (
              <svg viewBox="0 0 16 16" className="h-3 w-3 text-bg">
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
          <div
            className={`font-sans text-[14px] leading-snug ${
              isDone ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink'
            }`}
          >
            {milestone.title}
          </div>
          {milestone.weight !== 1 && (
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
              weight {milestone.weight}
            </div>
          )}
        </div>

        {/* Edit + delete affordances live in a <details> to keep the row
            scannable. Click "edit" to swap to the form. */}
        <details className="shrink-0">
          <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors pt-1">
            Edit
          </summary>
          <div className="absolute z-10 mt-1 right-5 lg:right-0 bg-bg border border-line shadow-lg p-3 min-w-[260px]">
            <form action={updateMilestoneAction} className="flex flex-col gap-2">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="milestone_id" value={milestone.id} />
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Title</span>
                <input
                  type="text"
                  name="title"
                  defaultValue={milestone.title}
                  className="bg-transparent border border-line focus:border-accent focus:outline-none px-2 py-1.5 font-sans text-[13px] text-ink"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Weight</span>
                <input
                  type="number"
                  name="weight"
                  defaultValue={milestone.weight}
                  min={1}
                  step={1}
                  className="bg-transparent border border-line focus:border-accent focus:outline-none px-2 py-1.5 font-mono text-[13px] text-ink w-20"
                />
              </label>
              <button
                type="submit"
                className="px-2.5 py-1 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors self-start"
              >
                Save
              </button>
            </form>
            <form action={deleteMilestoneAction} className="mt-2 pt-2 border-t border-line">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="milestone_id" value={milestone.id} />
              <button
                type="submit"
                className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
              >
                Delete milestone
              </button>
            </form>
          </div>
        </details>
      </div>
    </li>
  );
}

// Weighted-progress percent. Mirrors the helper that lived inline on
// /projects/[id]; lifted here so the section owns its own display logic.
function computeProgressPct(milestones: Milestone[]): number {
  const totalWeight = milestones.reduce((s, m) => s + m.weight, 0);
  if (totalWeight === 0) return 0;
  const doneWeight = milestones
    .filter((m) => m.status === 'done')
    .reduce((s, m) => s + m.weight, 0);
  return Math.round((doneWeight / totalWeight) * 100);
}
