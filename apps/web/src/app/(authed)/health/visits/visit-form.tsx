'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createVisitAction, updateVisitAction, deleteVisitAction, type SaveResult } from './actions';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';
import { DateInput } from '@/components/DateInput';

interface InitialValues {
  id?: string;
  visit_date: string;
  provider_name: string;
  provider_specialty: string;
  visit_type: string;
  reason: string;
  assessment: string;
  plan: string;
  notes: string;
  follow_up_date: string;
}

const TYPES: Array<{ value: string; label: string }> = [
  { value: '', label: '(none)' },
  { value: 'annual', label: 'Annual / wellness' },
  { value: 'sick', label: 'Sick visit' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'lab', label: 'Lab' },
  { value: 'imaging', label: 'Imaging' },
  { value: 'urgent_care', label: 'Urgent care' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'telehealth', label: 'Telehealth' },
  { value: 'other', label: 'Other' },
];

export function VisitForm({ initial }: { initial: InitialValues }) {
  const isEdit = Boolean(initial.id);
  const action = isEdit ? updateVisitAction : createVisitAction;
  const [state, formAction] = useActionState<SaveResult | null, FormData>(action, null);
  const display = useTransientSaveResult(state);

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4 max-w-2xl mt-4">
        {initial.id && <input type="hidden" name="id" value={initial.id} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Date (required)</span>
            <DateInput
              name="visit_date"
              defaultValue={initial.visit_date}
              required
              className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Type</span>
            <select
              name="visit_type"
              defaultValue={initial.visit_type}
              className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Provider</span>
            <input
              type="text"
              name="provider_name"
              defaultValue={initial.provider_name}
              placeholder="Dr. Chen"
              className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Specialty</span>
            <input
              type="text"
              name="provider_specialty"
              defaultValue={initial.provider_specialty}
              placeholder="Internal medicine"
              className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">Reason / chief complaint</span>
          <input
            type="text"
            name="reason"
            defaultValue={initial.reason}
            placeholder="Annual checkup, persistent cough, knee pain…"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-3/60"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">Assessment / diagnosis</span>
          <textarea
            name="assessment"
            rows={2}
            defaultValue={initial.assessment}
            placeholder="What the provider concluded"
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">Plan</span>
          <textarea
            name="plan"
            rows={2}
            defaultValue={initial.plan}
            placeholder="Med changes, lab orders, follow-ups, lifestyle recs"
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">Notes</span>
          <textarea
            name="notes"
            rows={3}
            defaultValue={initial.notes}
            placeholder="Anything else worth remembering"
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
          />
        </label>

        <label className="flex flex-col gap-1 max-w-xs">
          <span className="eyebrow">Follow-up date (optional)</span>
          <DateInput
            name="follow_up_date"
            defaultValue={initial.follow_up_date}
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </label>

        <div className="flex items-center gap-3 pt-2">
          <SaveButton isEdit={isEdit} />
          {display?.ok === false && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{display.error}</span>
          )}
          {display?.ok === true && isEdit && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">✓ Saved</span>
          )}
        </div>
      </form>

      {isEdit && initial.id && (
        <form
          action={deleteVisitAction}
          onSubmit={(e) => {
            if (!confirm('Delete this visit? Linked metrics + labs + documents lose their visit reference but stay.')) {
              e.preventDefault();
            }
          }}
          className="mt-8 pt-4 border-t border-line max-w-2xl"
        >
          <input type="hidden" name="id" value={initial.id} />
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
          >
            Delete visit
          </button>
        </form>
      )}
    </>
  );
}

function SaveButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2 transition-colors"
    >
      {pending ? 'Saving…' : isEdit ? 'Save' : 'Create visit'}
    </button>
  );
}
