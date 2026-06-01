'use client';

import { useActionState, useRef, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { addResultAction, type SaveResult } from '../actions';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';

// Inline form for adding analytes one at a time. Stays mounted on the
// panel detail page so you can keep typing as you read off a report.

export function ResultForm({ panelId }: { panelId: string }) {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(addResultAction, null);
  const display = useTransientSaveResult(state);
  const formRef = useRef<HTMLFormElement>(null);
  const analyteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      analyteRef.current?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2 mt-3 p-3 border border-line/60">
      <input type="hidden" name="panel_id" value={panelId} />
      <div className="grid grid-cols-12 gap-2 items-end">
        <label className="col-span-12 sm:col-span-4 flex flex-col gap-1">
          <span className="eyebrow">Analyte</span>
          <input
            ref={analyteRef}
            type="text"
            name="analyte"
            required
            placeholder="HbA1c, LDL, TSH…"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1 font-sans text-[14px] text-ink"
          />
        </label>
        <label className="col-span-6 sm:col-span-2 flex flex-col gap-1">
          <span className="eyebrow">Value</span>
          <input
            type="number"
            step="any"
            name="value"
            inputMode="decimal"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1 font-sans text-[14px] text-ink"
          />
        </label>
        <label className="col-span-6 sm:col-span-2 flex flex-col gap-1">
          <span className="eyebrow">Unit</span>
          <input
            type="text"
            name="unit"
            placeholder="mg/dL"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1 font-sans text-[14px] text-ink"
          />
        </label>
        <label className="col-span-6 sm:col-span-2 flex flex-col gap-1">
          <span className="eyebrow">Range low</span>
          <input
            type="number"
            step="any"
            name="reference_range_low"
            inputMode="decimal"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1 font-sans text-[14px] text-ink"
          />
        </label>
        <label className="col-span-6 sm:col-span-2 flex flex-col gap-1">
          <span className="eyebrow">Range high</span>
          <input
            type="number"
            step="any"
            name="reference_range_high"
            inputMode="decimal"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1 font-sans text-[14px] text-ink"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <AddButton />
        {display?.ok === false && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{display.error}</span>
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
      className="border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider px-3 py-1 transition-colors disabled:opacity-40"
    >
      {pending ? 'Adding…' : '+ Add analyte'}
    </button>
  );
}
