'use client';

import { useTransition } from 'react';
import { setProjectStatusAction } from './actions';

type ProjectStatus = 'active' | 'paused' | 'done' | 'archived';

const STATUSES: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];

// One-tap status row. Lives next to the color picker on the project
// detail page. The Edit panel below still exposes status as part of the
// full form — the chip row is the discoverable surface for the common
// case ("mark this done").
export function ProjectStatusChips({
  projectId,
  current,
}: {
  projectId: string;
  current: ProjectStatus;
}) {
  const [pending, startTransition] = useTransition();

  const pick = (next: ProjectStatus) => {
    if (next === current) return;
    const form = new FormData();
    form.set('projectId', projectId);
    form.set('status', next);
    startTransition(async () => {
      await setProjectStatusAction(form);
    });
  };

  return (
    <div className={`flex items-center gap-2 ${pending ? 'opacity-50' : ''}`}>
      <span className="eyebrow shrink-0">Status</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUSES.map((s) => {
          const active = current === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => pick(s.value)}
              disabled={pending}
              aria-pressed={active}
              className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
                active
                  ? 'bg-ink text-bg border-ink'
                  : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
