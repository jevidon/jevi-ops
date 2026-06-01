'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateSectionAction, type SaveResult } from './actions';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';
import type { HistoryEntry } from '@/lib/api';

// A structured-but-loose section editor. Each row is an object with a
// flexible shape — the dominant field name depends on the section (name
// for conditions, procedure for surgeries, etc.) but ALL sections share
// a `notes` field. Add/remove rows, edit inline, save the whole array.

const SECTION_CONFIG: Record<string, {
  primaryField: keyof HistoryEntry;
  primaryLabel: string;
  secondaryField?: keyof HistoryEntry;
  secondaryLabel?: string;
}> = {
  conditions: { primaryField: 'name', primaryLabel: 'Condition', secondaryField: 'diagnosed_date', secondaryLabel: 'Diagnosed' },
  surgeries: { primaryField: 'procedure', primaryLabel: 'Procedure', secondaryField: 'date', secondaryLabel: 'Date' },
  allergies: { primaryField: 'allergen', primaryLabel: 'Allergen', secondaryField: 'reaction', secondaryLabel: 'Reaction' },
  immunizations: { primaryField: 'vaccine', primaryLabel: 'Vaccine', secondaryField: 'date', secondaryLabel: 'Date' },
  family_history: { primaryField: 'relation', primaryLabel: 'Relation', secondaryField: 'condition', secondaryLabel: 'Condition' },
};

export function HistorySection({
  section,
  initialEntries,
  label,
}: {
  section: keyof typeof SECTION_CONFIG;
  initialEntries: HistoryEntry[];
  label: string;
}) {
  // Section is a key of SECTION_CONFIG so this lookup is always defined;
  // the non-null assertion satisfies noUncheckedIndexedAccess.
  const config = SECTION_CONFIG[section]!;
  const [entries, setEntries] = useState<HistoryEntry[]>(initialEntries.length > 0 ? initialEntries : []);
  const [state, formAction] = useActionState<SaveResult | null, FormData>(updateSectionAction, null);
  const display = useTransientSaveResult(state);

  function updateRow(idx: number, field: keyof HistoryEntry, value: string) {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)));
  }
  function addRow() {
    setEntries((prev) => [...prev, {}]);
  }
  function removeRow(idx: number) {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <section>
      <div className="eyebrow pb-2 border-b border-line mb-3 flex items-baseline justify-between">
        <span>{label}</span>
        <button
          type="button"
          onClick={addRow}
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          + Add row
        </button>
      </div>
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="section" value={section} />
        <input type="hidden" name="entries_json" value={JSON.stringify(entries)} />

        {entries.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic">No entries.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((e, idx) => (
              <li key={idx} className="grid grid-cols-12 gap-2 items-end pb-2 border-b border-line/40">
                <label className="col-span-12 sm:col-span-4 flex flex-col gap-1">
                  <span className="eyebrow">{config.primaryLabel}</span>
                  <input
                    type="text"
                    value={String(e[config.primaryField] ?? '')}
                    onChange={(ev) => updateRow(idx, config.primaryField, ev.target.value)}
                    className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1 font-sans text-[13px] text-ink"
                  />
                </label>
                {config.secondaryField && (
                  <label className="col-span-12 sm:col-span-3 flex flex-col gap-1">
                    <span className="eyebrow">{config.secondaryLabel}</span>
                    <input
                      type="text"
                      value={String(e[config.secondaryField] ?? '')}
                      onChange={(ev) => updateRow(idx, config.secondaryField!, ev.target.value)}
                      className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1 font-sans text-[13px] text-ink"
                    />
                  </label>
                )}
                <label className="col-span-10 sm:col-span-4 flex flex-col gap-1">
                  <span className="eyebrow">Notes</span>
                  <input
                    type="text"
                    value={e.notes ?? ''}
                    onChange={(ev) => updateRow(idx, 'notes', ev.target.value)}
                    className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1 font-sans text-[13px] text-ink"
                  />
                </label>
                <div className="col-span-2 sm:col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    aria-label="Remove row"
                    className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3 pt-2">
          <SaveButton />
          {display?.ok === false && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{display.error}</span>
          )}
          {display?.ok === true && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">✓ Saved</span>
          )}
        </div>
      </form>
    </section>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider px-3 py-1 transition-colors disabled:opacity-40"
    >
      {pending ? 'Saving…' : 'Save section'}
    </button>
  );
}
