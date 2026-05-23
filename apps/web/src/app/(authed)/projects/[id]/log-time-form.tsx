'use client';

import { useActionState, useEffect, useRef } from 'react';
import { addActivityAction, type SaveResult } from './activity-actions';

// Inline "log time" form mounted above the activity list. Three inputs:
// `entry` (what you did), `hours` (free-form: 1.5, "1h30m", "45m"), and
// an optional `logged_at` (datetime-local) for backfilling — leave blank
// and the server stamps "now". Submitting refreshes the activity list
// and bumps the project's total hours via the server action.
// Description-only entries (no hours) are allowed — useful for status
// notes ("client called, requested scope change").

export function LogTimeForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    addActivityAction,
    null,
  );
  const entryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      // Clear + refocus so chained entries are easy.
      entryRef.current?.form?.reset();
      entryRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className="mb-4">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="flex flex-wrap gap-2">
        <input
          ref={entryRef}
          type="text"
          name="entry"
          required
          placeholder="What did you work on?"
          disabled={pending}
          autoComplete="off"
          className="flex-1 min-w-[200px] bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-3"
        />
        <input
          type="text"
          name="hours"
          // Free-form so the activity-action's parseHours can accept any
          // of: 1.5, 1h, 1h30m, 45m. Number input would block letters.
          placeholder="1h30m"
          disabled={pending}
          inputMode="text"
          autoComplete="off"
          aria-label="Hours (e.g. 1.5, 1h30m, 45m)"
          title="Hours — enter a number (1.5), or '1h30m', '45m'"
          className="w-24 bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-mono text-[13px] text-ink text-center placeholder:text-ink-3/60"
        />
        <input
          type="datetime-local"
          name="logged_at"
          disabled={pending}
          aria-label="When"
          title="When (optional — leave blank to stamp 'now')"
          className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-mono text-[12px] text-ink-2"
        />
        <button
          type="submit"
          disabled={pending}
          className="px-2.5 py-1 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? 'Logging…' : 'Log'}
        </button>
      </div>
      {state && !state.ok && (
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-accent">
          {state.error}
        </div>
      )}
    </form>
  );
}
