'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createDomainAction, type CreateResult } from './actions';

// Minimal on purpose — name + description. expected_cadence is deliberately
// absent (the cadence rule editor on the detail page is the machine-readable
// source of truth; see the note in edit-domain-form.tsx), as are staleness
// and illustration controls.

export function DomainCreateForm() {
  const [state, formAction] = useActionState<CreateResult | null, FormData>(
    createDomainAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1">
        <span className="eyebrow">Name</span>
        <input
          type="text"
          name="name"
          required
          autoFocus
          autoComplete="off"
          placeholder="e.g. Homestead, Health, The Channel"
          className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[15px] text-ink"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="eyebrow">Description</span>
        <textarea
          name="description"
          rows={2}
          placeholder="What this domain is — short context."
          className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
        />
      </label>

      <p className="font-sans text-[12px] text-ink-3 leading-relaxed">
        Cadence rules, staleness flags, and the engraved illustration are set
        up on the domain page after it exists.
      </p>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {state && !state.ok && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-accent">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2 transition-colors"
    >
      {pending ? 'Creating…' : 'Create domain'}
    </button>
  );
}
