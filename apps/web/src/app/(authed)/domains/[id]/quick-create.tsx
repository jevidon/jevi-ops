'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createProjectAction, type SaveResult as ProjectSaveResult } from '../../projects/actions';

// In-page creation for the domain detail view.
//
// Task quick-add moved to the shared <QuickAddTask /> (components/
// QuickAddTask.tsx) when the Work page grew the same control.
//
// ProjectQuickCreate: name + kind, reusing the projects screen's
// createProjectAction verbatim via hidden fields — on success that
// action redirects to the new project's page, which is where you'd be
// heading anyway to flesh it out.

export function ProjectQuickCreate({ domainId }: { domainId: string }) {
  const [state, formAction] = useActionState<ProjectSaveResult | null, FormData>(
    createProjectAction,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="domain_id" value={domainId} />
      <div className="flex items-center gap-2 flex-wrap">
        <input
          name="name"
          placeholder="Name…"
          autoComplete="off"
          className="flex-1 min-w-[160px] bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-4"
        />
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-2 cursor-pointer">
            <input type="radio" name="kind" value="project" defaultChecked className="accent-accent" />
            Project
          </label>
          <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-2 cursor-pointer">
            <input type="radio" name="kind" value="area" className="accent-accent" />
            Area
          </label>
        </div>
        <QuickSubmit label="Create" pendingLabel="Creating…" />
      </div>
      {state?.ok === false && (
        <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">
          {state.error}
        </div>
      )}
    </form>
  );
}

function QuickSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 transition-colors disabled:opacity-40"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
