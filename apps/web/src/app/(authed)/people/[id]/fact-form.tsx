'use client';

import { useActionState, useEffect, useRef } from 'react';
import { addFactAction, type SaveResult } from './fact-actions';
import { DateInput } from '@/components/DateInput';

// Inline "+ add a fact" form on the person detail page. Fact type =
// dropdown of birthday/anniversary/kid_name/etc.; value = freeform text;
// optional date (used for birthday/anniversary recurrence + upcoming).
// Recurring checkbox flips the DB flag so daily-summary scans can pick
// up "X turns 40 next Tuesday".

const FACT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
  { value: 'kid_name', label: 'Kid' },
  { value: 'shared', label: 'Shared interest' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'other', label: 'Other' },
];

export function FactForm({ personId }: { personId: string }) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    addFactAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      valueRef.current?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2 mt-3 pt-3 border-t border-line/40">
      <input type="hidden" name="person_id" value={personId} />
      <div className="flex flex-wrap gap-2">
        <select
          name="fact_type"
          defaultValue="birthday"
          disabled={pending}
          className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[13px] text-ink"
        >
          {FACT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          ref={valueRef}
          type="text"
          name="fact_value"
          required
          placeholder="e.g. May 3, or 'Henry, age 4'"
          disabled={pending}
          autoComplete="off"
          className="flex-1 min-w-[160px] bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[13px] text-ink placeholder:text-ink-3/60"
        />
        <DateInput
          name="date_relevant"
          disabled={pending}
          aria-label="Date"
          title="Date (optional, used for upcoming reminders)"
          className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-mono text-[12px] text-ink"
        />
        <label className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ink-3 cursor-pointer">
          <input type="checkbox" name="recurring" className="accent-accent" />
          Recurs
        </label>
        <button
          type="submit"
          disabled={pending}
          className="px-2.5 py-1 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40"
        >
          {pending ? 'Adding…' : 'Add fact'}
        </button>
      </div>
      {state && !state.ok && (
        <div className="font-mono text-[10px] uppercase tracking-wider text-accent">
          {state.error}
        </div>
      )}
    </form>
  );
}
