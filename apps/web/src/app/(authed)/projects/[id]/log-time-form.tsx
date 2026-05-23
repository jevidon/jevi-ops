'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { addActivityAction, type SaveResult } from './activity-actions';

// Inline "log time / log update" form above the activity list. Two modes:
//   - Work (default) — what you did, hours-loggable
//   - Update — wins, status notes, events. No hours field; "kind=update"
//     surfaces in the feed with distinct styling
// Optional backfill datetime applies to both modes. Submitting refreshes
// the activity list and (in Work mode) bumps the project total hours.

export function LogTimeForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    addActivityAction,
    null,
  );
  const [kind, setKind] = useState<'work' | 'update'>('work');
  const entryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      // Clear + refocus so chained entries are easy.
      entryRef.current?.form?.reset();
      entryRef.current?.focus();
      // Reset to default kind so the next entry isn't accidentally
      // logged as the previous one's kind.
      setKind('work');
    }
  }, [state]);

  return (
    <form action={formAction} className="mb-4">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="kind" value={kind} />

      {/* Kind toggle — small chip pair above the inputs. */}
      <div className="flex gap-1.5 mb-2">
        <button
          type="button"
          onClick={() => setKind('work')}
          className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
            kind === 'work' ? 'bg-ink text-bg border-ink' : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
          }`}
        >
          Work
        </button>
        <button
          type="button"
          onClick={() => setKind('update')}
          className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
            kind === 'update' ? 'bg-accent text-bg border-accent' : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
          }`}
          title="Log an event/win/status note (no hours)"
        >
          📌 Update
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          ref={entryRef}
          type="text"
          name="entry"
          required
          placeholder={kind === 'work' ? 'What did you work on?' : 'What happened? (client win, status change…)'}
          disabled={pending}
          autoComplete="off"
          className="flex-1 min-w-[200px] bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-3"
        />
        {/* Hours only apply to Work entries. Hidden in Update mode so
            you can't accidentally tie hours to a win/event. */}
        {kind === 'work' && (
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
        )}
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
