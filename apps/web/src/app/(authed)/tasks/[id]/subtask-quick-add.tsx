'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { useToast } from '@/components/toast/ToastProvider';
import { createSubtaskAction, type SubtaskResult } from './actions';

// Subtask quick-add row (extracted from the server-rendered SubtasksSection so
// it can carry pending/error/toast state — the old bare <form> swallowed
// failures silently). Mirrors QuickAddTask: reset + refocus on success so
// several subtasks can be captured in a row.
export function SubtaskQuickAdd({
  parentId,
  projectId,
  domainId,
}: {
  parentId: string;
  projectId?: string | null;
  domainId?: string | null;
}) {
  const [state, formAction] = useActionState<SubtaskResult | null, FormData>(
    createSubtaskAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      inputRef.current?.focus();
      toast({ message: 'Subtask added.', action: { label: 'View', href: `/tasks/${state.id}` } });
    }
  }, [state, toast]);

  return (
    <form ref={formRef} action={formAction} className="py-2">
      <div className="flex items-center gap-3">
        <span className="h-5 w-5 border border-dashed border-line-strong shrink-0" aria-hidden />
        <input type="hidden" name="parentId" value={parentId} />
        {projectId ? (
          <input type="hidden" name="projectId" value={projectId} />
        ) : (
          domainId && <input type="hidden" name="domainId" value={domainId} />
        )}
        <input
          ref={inputRef}
          type="text"
          name="title"
          required
          placeholder="Add subtask…"
          autoComplete="off"
          aria-label="Add subtask"
          className="flex-1 min-w-0 bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1 font-sans text-[14px] text-ink placeholder:text-ink-4"
        />
        <SubtaskSubmit />
      </div>
      {state?.ok === false && (
        <div className="mt-1.5 pl-8 font-mono text-[10px] uppercase tracking-wider text-accent">
          {state.error}
        </div>
      )}
    </form>
  );
}

function SubtaskSubmit() {
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
