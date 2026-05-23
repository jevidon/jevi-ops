'use client';

import { useActionState, useEffect, useRef } from 'react';
import { addInteractionAction, type SaveResult } from './interaction-actions';

// "Log interaction" form. Type dropdown + freeform notes + optional
// backfill datetime. Submitting writes a person_interactions row and
// the detail page revalidates so the new row appears immediately.

const INTERACTION_TYPES: Array<{ value: string; label: string }> = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'text', label: 'Text' },
  { value: 'in_person', label: 'In person' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'other', label: 'Other' },
];

export function InteractionForm({ personId }: { personId: string }) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    addInteractionAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      notesRef.current?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2 mt-3 pt-3 border-t border-line/40">
      <input type="hidden" name="person_id" value={personId} />
      <div className="flex flex-wrap gap-2 items-end">
        <select
          name="interaction_type"
          defaultValue="call"
          disabled={pending}
          aria-label="Interaction type"
          className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[13px] text-ink"
        >
          {INTERACTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          ref={notesRef}
          type="text"
          name="notes"
          placeholder="What did you talk about?"
          disabled={pending}
          autoComplete="off"
          className="flex-1 min-w-[200px] bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[13px] text-ink placeholder:text-ink-3/60"
        />
        <input
          type="datetime-local"
          name="occurred_at"
          disabled={pending}
          aria-label="When"
          title="When it happened (optional — defaults to now)"
          className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-mono text-[12px] text-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="px-2.5 py-1 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40"
        >
          {pending ? 'Logging…' : 'Log'}
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
