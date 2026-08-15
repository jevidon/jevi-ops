'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  addChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
  type SaveResult,
} from './checklist-actions';
import type { ProjectChecklistItem } from '@/lib/api';
import {
  isCurrentlyDoneRecurring,
  isRecurrencePattern,
  RECURRENCE_LABELS,
  type RecurrencePattern,
} from '@jerad-ops/shared';

// Project sub-step checklist. Each row is its own form (toggle, delete)
// so submissions stay scoped per item.
//
// New in 0018: recurrence_rule. When set, "currently done" is derived
// from done_at + the current period — the checkbox auto-shows as
// unchecked once the period rolls over without any cron involvement.
// Toggling a recurring item just bumps done_at to now.

const RECURRENCE_GLYPH = '↻';

const RECURRENCE_OPTIONS: Array<{ value: '' | RecurrencePattern; label: string }> = [
  { value: '', label: 'One-shot (default)' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'semiannually', label: 'Every 6 months' },
  { value: 'yearly', label: 'Yearly' },
];

// Compute the right "is this currently checked" value for an item,
// taking the recurrence_rule into account. Memoized to today via the
// caller — for recurring items the answer changes when the period
// rolls over, but the page re-fetches on every navigation so this is
// fine without explicit cache busting.
function currentlyDone(item: ProjectChecklistItem): boolean {
  if (item.recurrence_rule && isRecurrencePattern(item.recurrence_rule)) {
    return isCurrentlyDoneRecurring(
      item.done,
      item.done_at,
      item.recurrence_rule,
    );
  }
  return item.done;
}

export function ChecklistSection({
  projectId,
  items,
}: {
  projectId: string;
  items: ProjectChecklistItem[];
}) {
  const decorated = items.map((i) => ({ item: i, done: currentlyDone(i) }));
  const doneCount = decorated.filter((d) => d.done).length;

  return (
    <section className="mt-6 first:mt-0">
      <div className="flex items-baseline justify-between mb-3 border-b border-line pb-2">
        <div className="eyebrow">
          Checklist {items.length > 0 ? `· ${doneCount}/${items.length}` : ''}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="font-sans text-[13px] text-ink-3 italic mb-4">
          No checklist yet. Use this for granular sub-steps that don&rsquo;t
          warrant a full task or milestone. Recurring items (weekly status
          report, monthly invoice…) live well here too.
        </div>
      ) : (
        <ul className="mb-4 space-y-1">
          {decorated.map(({ item, done }) => (
            <ChecklistRow key={item.id} projectId={projectId} item={item} done={done} />
          ))}
        </ul>
      )}

      <AddChecklistItemForm projectId={projectId} />
    </section>
  );
}

function ChecklistRow({
  projectId,
  item,
  done,
}: {
  projectId: string;
  item: ProjectChecklistItem;
  done: boolean;
}) {
  const rule = isRecurrencePattern(item.recurrence_rule) ? item.recurrence_rule : null;

  return (
    <li className="flex items-center gap-3 py-1.5 group">
      <form action={toggleChecklistItemAction} className="shrink-0">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="itemId" value={item.id} />
        {/* For recurring items the underlying `done` column might be
            stuck on true from a previous period — but `done` here is
            the *derived* current value, so we toggle from that. */}
        <input type="hidden" name="done" value={done ? 'false' : 'true'} />
        <button
          type="submit"
          aria-label={done ? 'Mark not done' : 'Mark done'}
          className={`h-5 w-5 border-2 flex items-center justify-center transition-colors ${
            done ? 'bg-ink border-ink text-bg' : 'border-line hover:border-ink-2'
          }`}
        >
          {done && (
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </form>
      <span
        className={`flex-1 font-sans text-[14px] leading-snug ${
          done ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink'
        }`}
      >
        {item.title}
      </span>
      {rule && (
        <span
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0"
          title={`Recurs ${RECURRENCE_LABELS[rule].toLowerCase()} — auto-resets on each new period.`}
        >
          {RECURRENCE_GLYPH} {RECURRENCE_LABELS[rule]}
        </span>
      )}
      <form action={deleteChecklistItemAction} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="itemId" value={item.id} />
        <button
          type="submit"
          aria-label="Delete item"
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          ✕
        </button>
      </form>
    </li>
  );
}

function AddChecklistItemForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    addChecklistItemAction,
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [recurrence, setRecurrence] = useState<'' | RecurrencePattern>('');

  useEffect(() => {
    if (state?.ok) {
      // Clear the input on success so you can chain entries quickly.
      inputRef.current?.form?.reset();
      inputRef.current?.focus();
      setRecurrence('');
    }
  }, [state]);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <span className="text-ink-3 text-[14px] select-none" aria-hidden>+</span>
      <input
        ref={inputRef}
        type="text"
        name="title"
        required
        placeholder="Add a checklist item…"
        autoComplete="off"
        disabled={pending}
        className="flex-1 min-w-[160px] bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] placeholder:text-ink-3/70 text-ink"
      />
      <select
        name="recurrence_rule"
        value={recurrence}
        onChange={(e) => setRecurrence(e.target.value as '' | RecurrencePattern)}
        disabled={pending}
        title="Recurrence — when set, the item auto-resets each period"
        className="bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-3"
      >
        {RECURRENCE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {state && !state.ok && (
        <span className="font-mono text-[10px] uppercase text-accent">{state.error}</span>
      )}
    </form>
  );
}
