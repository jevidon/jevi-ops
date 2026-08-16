'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { quickAddTaskAction, type QuickAddResult } from './quick-add-task-action';

// Quick task add (Wave 2 #2) — the one shared "type a title and continue"
// control, lifted from the domain detail page's TaskQuickAdd. Three mounts:
//
//   <QuickAddTask domainId={id} />                  — domain detail (direct task)
//   <QuickAddTask projectId={id} />                 — project detail
//   <QuickAddTask domainId={id} projects={[...]}
//                 collapsible />                    — Work page sections: a
//     "+ Task" toggle expands an input + target select (direct to the domain,
//     or into one of its projects), so the manager's map stays calm until
//     you're capturing.
//
// A successful add clears the input but keeps the row open — capture several
// in a row without re-opening.

export function QuickAddTask({
  domainId,
  projectId,
  projects,
  placeholder = 'Quick add — just a title…',
  collapsible = false,
}: {
  domainId?: string;
  projectId?: string;
  // When given, a target select renders: '' = direct to the domain, else the
  // chosen project id (the server derives its domain).
  projects?: { id: string; name: string }[];
  placeholder?: string;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const [state, formAction] = useActionState<QuickAddResult | null, FormData>(
    quickAddTaskAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState('');

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      inputRef.current?.focus();
    }
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors"
      >
        + Task
      </button>
    );
  }

  const hasSelect = !!projects?.length;
  return (
    <form ref={formRef} action={formAction} className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        {/* Fixed targets ride as hidden fields; the Work variant swaps them
            for the select's choice. */}
        {hasSelect ? (
          <>
            <input type="hidden" name="domain_id" value={target ? '' : (domainId ?? '')} />
            <input type="hidden" name="project_id" value={target} />
          </>
        ) : (
          <>
            {domainId && <input type="hidden" name="domain_id" value={domainId} />}
            {projectId && <input type="hidden" name="project_id" value={projectId} />}
          </>
        )}
        <input
          ref={inputRef}
          name="title"
          placeholder={placeholder}
          autoComplete="off"
          autoFocus={collapsible}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && collapsible) setOpen(false);
          }}
          className="flex-1 min-w-0 bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-4"
        />
        {hasSelect && (
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Add into"
            className="max-w-[160px] shrink-0 bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-2"
          >
            <option value="">Direct to domain</option>
            {projects!.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <QuickSubmit />
        {collapsible && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close quick add"
            className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
          >
            ✕
          </button>
        )}
      </div>
      {state?.ok === false && (
        <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">
          {state.error}
        </div>
      )}
    </form>
  );
}

function QuickSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 transition-colors disabled:opacity-40"
    >
      {pending ? 'Adding…' : 'Add'}
    </button>
  );
}
