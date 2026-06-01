'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createCheckInAction, type SaveResult } from './actions';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';

// Inline check-in form. Four rating selects + a notes textarea. Submitting
// clears on success so chaining a quick "morning then evening" pair is
// frictionless.

export function CheckInForm() {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(createCheckInAction, null);
  const display = useTransientSaveResult(state);

  return (
    <form action={formAction} className="flex flex-col gap-3 mt-4 max-w-2xl">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <RatingSelect name="mood" label="Mood" max={5} />
        <RatingSelect name="energy" label="Energy" max={5} />
        <RatingSelect name="sleep_quality" label="Sleep" max={5} />
        <RatingSelect name="pain" label="Pain" max={10} min={0} />
      </div>
      <label className="flex flex-col gap-1">
        <span className="eyebrow">Notes</span>
        <textarea
          name="notes"
          rows={2}
          placeholder="Anything to add — context, what helped, what didn't"
          className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
        />
      </label>
      <div className="flex items-center gap-3">
        <SaveButton />
        {display?.ok === false && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{display.error}</span>
        )}
        {display?.ok === true && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">✓ Logged</span>
        )}
      </div>
    </form>
  );
}

function RatingSelect({ name, label, max, min = 1 }: { name: string; label: string; max: number; min?: number }) {
  const options: Array<number | ''> = ['' as const];
  for (let i = min; i <= max; i++) options.push(i);
  return (
    <label className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      <select
        name={name}
        defaultValue=""
        className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
      >
        {options.map((o, i) => (
          <option key={i} value={o === '' ? '' : String(o)}>
            {o === '' ? '—' : `${o}${min === 0 ? '' : ` / ${max}`}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2 transition-colors"
    >
      {pending ? 'Saving…' : 'Log check-in'}
    </button>
  );
}
