'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createPanelAction, type SaveResult } from './actions';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';
import { DateInput } from '@/components/DateInput';

// Just the panel shell. Individual lab results are added on the panel
// detail page, which lets you add analytes one at a time as you type
// them off the report.

export function PanelForm() {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(createPanelAction, null);
  const display = useTransientSaveResult(state);

  return (
    <form action={formAction} className="flex flex-col gap-3 max-w-2xl mt-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Drawn date (required)</span>
          <DateInput
            name="drawn_date"
            required
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Panel name (required)</span>
          <input
            type="text"
            name="panel_name"
            required
            placeholder="CBC, CMP, Lipid, HbA1c…"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Ordering provider</span>
          <input
            type="text"
            name="ordering_provider"
            placeholder="Dr. Chen"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Lab facility</span>
          <input
            type="text"
            name="lab_facility"
            placeholder="Quest, LabCorp, hospital lab"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="eyebrow">Notes</span>
        <textarea
          name="notes"
          rows={2}
          className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
        />
      </label>
      <div className="flex items-center gap-3 pt-2">
        <SaveButton />
        {display?.ok === false && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{display.error}</span>
        )}
      </div>
    </form>
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
      {pending ? 'Saving…' : 'Create panel'}
    </button>
  );
}
