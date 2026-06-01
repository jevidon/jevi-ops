'use client';

import { useActionState, useRef, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { createMedAction, type SaveResult } from './actions';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';
import { DateInput } from '@/components/DateInput';

export function MedForm() {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(createMedAction, null);
  const display = useTransientSaveResult(state);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      nameRef.current?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3 max-w-2xl mt-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Name (required)</span>
          <input
            ref={nameRef}
            type="text"
            name="name"
            required
            placeholder="Lisinopril, Vitamin D, Magnesium…"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Kind</span>
          <select
            name="kind"
            defaultValue="prescription"
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            <option value="prescription">Prescription</option>
            <option value="supplement">Supplement</option>
            <option value="vitamin">Vitamin</option>
            <option value="otc">OTC</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Dosage</span>
          <input
            type="text"
            name="dosage"
            placeholder="10mg, 5000 IU, 1 tab"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Frequency</span>
          <input
            type="text"
            name="frequency"
            placeholder="Daily, twice daily, as needed"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Prescribing provider</span>
          <input
            type="text"
            name="prescribing_provider"
            placeholder="Optional"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Reason</span>
          <input
            type="text"
            name="reason"
            placeholder="What it's for"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 max-w-xs">
        <span className="eyebrow">Start date</span>
        <DateInput
          name="start_date"
          className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="eyebrow">Notes</span>
        <textarea
          name="notes"
          rows={2}
          className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
        />
      </label>
      <div className="flex items-center gap-3">
        <AddButton />
        {display?.ok === false && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{display.error}</span>
        )}
        {display?.ok === true && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">✓ Added</span>
        )}
      </div>
    </form>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2 transition-colors"
    >
      {pending ? 'Adding…' : 'Add'}
    </button>
  );
}
