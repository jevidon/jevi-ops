'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateNarrativeAction, type SaveResult } from './actions';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';

export function NarrativeForm({ initialNarrative }: { initialNarrative: string }) {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(updateNarrativeAction, null);
  const display = useTransientSaveResult(state);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <textarea
        name="narrative"
        rows={6}
        defaultValue={initialNarrative}
        placeholder="The story so far — chronic conditions, major events, relevant context. Free-text; structure goes in the sections below."
        className="bg-transparent border border-line focus:border-accent focus:outline-none p-3 font-sans text-[14px] text-ink leading-relaxed resize-y placeholder:text-ink-3/60"
      />
      <div className="flex items-center gap-3">
        <SaveButton />
        {display?.ok === false && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{display.error}</span>
        )}
        {display?.ok === true && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">✓ Saved</span>
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
      className="self-start border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider px-3 py-1 transition-colors disabled:opacity-40"
    >
      {pending ? 'Saving…' : 'Save narrative'}
    </button>
  );
}
