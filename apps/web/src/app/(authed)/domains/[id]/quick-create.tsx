'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createProjectAction, type SaveResult as ProjectSaveResult } from '../../projects/actions';

// In-page creation for the domain detail view (and, with assetId, the
// asset page — the asset is the area, so its improvement projects are
// created right there).
//
// Task quick-add moved to the shared <QuickAddTask /> (components/
// QuickAddTask.tsx) when the Work page grew the same control.
//
// ProjectQuickCreate: name + kind, reusing the projects screen's
// createProjectAction verbatim via hidden fields — on success that
// action redirects to the new project's page, which is where you'd be
// heading anyway to flesh it out. With status="idea" (0050) it captures
// a candidate instead, and returnTo keeps you on the page you were on.

export function ProjectQuickCreate({
  domainId,
  assetId,
  placeholder = 'Name…',
  status,
  returnTo,
  submitLabel,
}: {
  domainId?: string | null;
  // Groups the new project under an asset; with no domainId the server
  // inherits the asset's domain.
  assetId?: string;
  placeholder?: string;
  // 'idea': a candidate, off the Work board until promoted.
  status?: 'idea';
  // Same-origin path to land on after creating (default: the new project).
  returnTo?: string;
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState<ProjectSaveResult | null, FormData>(
    createProjectAction,
    null,
  );

  return (
    <form action={formAction}>
      {domainId && <input type="hidden" name="domain_id" value={domainId} />}
      {assetId && <input type="hidden" name="asset_id" value={assetId} />}
      {status && <input type="hidden" name="status" value={status} />}
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          name="name"
          placeholder={placeholder}
          autoComplete="off"
          className="flex-1 min-w-[160px] bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-4"
        />
        {/* Under an asset the kind is always a project — the asset IS the area. */}
        {assetId ? (
          <input type="hidden" name="kind" value="project" />
        ) : (
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
        )}
        <QuickSubmit label={submitLabel ?? (status === 'idea' ? 'Add idea' : 'Create')} pendingLabel={status === 'idea' ? 'Adding…' : 'Creating…'} />
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
