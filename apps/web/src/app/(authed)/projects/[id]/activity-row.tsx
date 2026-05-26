'use client';

import { useActionState, useState } from 'react';
import type { ActivityLogEntry } from '@/lib/api';
import {
  updateActivityAction,
  deleteActivityAction,
  type SaveResult,
} from './activity-actions';
import { DateTimeInput } from '@/components/DateTimeInput';
import { useAppTimezone } from '@/components/TimezoneProvider';

// One row of the activity log on /projects/[id]. Read mode is the
// compact display we had before. Click the timestamp (or the hover-only
// Edit affordance) to flip into edit mode with three inputs:
//   - entry (what you did)
//   - hours (free-form parser — 1.5, 1h30m, 45m, blank to clear)
//   - logged_at (datetime-local, treated as America/Denver)
// Saving routes through updateActivityAction which handles the hours
// delta on projects.hours_logged. Cancel returns to read mode.

export function ActivityRow({
  entry,
  projectId,
}: {
  entry: ActivityLogEntry;
  projectId: string;
}) {
  const tz = useAppTimezone();
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    updateActivityAction,
    null,
  );

  // When a save succeeds, flip back to read mode. The page revalidation
  // triggered by the action will rerender with fresh data.
  if (state?.ok && editing) {
    // Schedule the flip after the current render — calling setState
    // synchronously here would warn in dev. Microtask is fine.
    queueMicrotask(() => setEditing(false));
  }

  if (!editing) return <ReadRow entry={entry} projectId={projectId} tz={tz} onEdit={() => setEditing(true)} />;

  return (
    <li className="py-3 border-b border-line/40 last:border-b-0 bg-surface-2/30 -mx-2 px-2">
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="entry_id" value={entry.id} />

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            name="entry"
            required
            defaultValue={entry.entry}
            disabled={pending}
            autoComplete="off"
            className="flex-1 min-w-[200px] bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
          <input
            type="text"
            name="hours"
            defaultValue={
              entry.hours_logged != null && Number(entry.hours_logged) > 0
                ? Number(entry.hours_logged).toString()
                : ''
            }
            placeholder="1h30m"
            disabled={pending}
            inputMode="text"
            autoComplete="off"
            aria-label="Hours (e.g. 1.5, 1h30m, 45m)"
            title="Hours — enter a number (1.5), or '1h30m', '45m', or blank to clear"
            className="w-24 bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-mono text-[13px] text-ink text-center placeholder:text-ink-3/60"
          />
          <DateTimeInput
            name="logged_at"
            defaultValue={toDatetimeLocalValue(entry.logged_at, tz)}
            disabled={pending}
            aria-label="When"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-mono text-[12px] text-ink-2"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="px-2.5 py-1 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
          >
            Cancel
          </button>
          {state && !state.ok && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
              {state.error}
            </span>
          )}
        </div>
      </form>
    </li>
  );
}

function ReadRow({
  entry,
  projectId,
  tz,
  onEdit,
}: {
  entry: ActivityLogEntry;
  projectId: string;
  tz: string;
  onEdit: () => void;
}) {
  const when = new Date(entry.logged_at).toLocaleString('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const hours = Number(entry.hours_logged ?? 0);
  const isUpdate = entry.kind === 'update';
  return (
    <li
      className={`flex items-start gap-4 py-2.5 border-b border-line/40 last:border-b-0 group ${
        // Update entries get a rust left border so wins/events stand
        // out when scanning the timeline.
        isUpdate ? 'border-l-2 border-l-accent pl-3 -ml-3' : ''
      }`}
    >
      {/* The timestamp doubles as the edit affordance — clicking the
          time is the most natural way to ask "let me change when this
          happened." */}
      <button
        type="button"
        onClick={onEdit}
        className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink w-24 pt-1 shrink-0 text-left transition-colors"
        title="Click to edit"
      >
        {when}
      </button>
      <div className="flex-1 min-w-0">
        {isUpdate && (
          <div className="font-mono text-[10px] uppercase tracking-wider text-accent mb-0.5">
            📌 Update
          </div>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="block w-full text-left font-sans text-[13px] text-ink leading-snug hover:text-accent transition-colors"
        >
          {entry.entry}
        </button>
        {hours > 0 && !isUpdate && (
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {hours.toFixed(2)}h
            {entry.source === 'voice' && ' · voice'}
            {entry.source === 'manual' && ' · manual'}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pt-1">
        <button
          type="button"
          onClick={onEdit}
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors"
        >
          Edit
        </button>
        <form action={deleteActivityAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="entry_id" value={entry.id} />
          <button
            type="submit"
            aria-label="Delete entry"
            title={hours > 0 ? `Delete · rolls back ${hours.toFixed(2)}h` : 'Delete entry'}
            className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
          >
            ✕
          </button>
        </form>
      </div>
    </li>
  );
}

// Convert a UTC ISO timestamp to the value format a <datetime-local>
// input expects ("YYYY-MM-DDTHH:mm"), interpreted in the app's TZ.
// The server action mirrors this conversion in reverse.
function toDatetimeLocalValue(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}
