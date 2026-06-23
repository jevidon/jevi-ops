'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateDomainAction, type SaveResult } from './actions';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';

// `expected_cadence` used to live in this form as a free-text field —
// removed once the cadence rule editor below the form became the
// machine-readable source of truth. The column stays in the DB for
// backwards compat but isn't editable from the UI anymore.
interface InitialValues {
  id: string;
  name: string;
  description: string;
  fruit_definition: string;
  active: boolean;
}

export function EditDomainForm({ initial }: { initial: InitialValues }) {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(
    updateDomainAction,
    null,
  );
  const display = useTransientSaveResult(state);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={initial.id} />

      <Field label="Name">
        <input
          type="text"
          name="name"
          required
          defaultValue={initial.name}
          autoComplete="off"
          className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[15px] text-ink"
        />
      </Field>

      <Field label="Description">
        <textarea
          name="description"
          rows={2}
          defaultValue={initial.description}
          placeholder="What this domain is — short context."
          className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
        />
      </Field>

      <Field label="Fruit definition">
        <textarea
          name="fruit_definition"
          rows={2}
          defaultValue={initial.fruit_definition}
          placeholder="What good looks like in this domain."
          className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
        />
      </Field>

      <label className="flex items-center gap-2 font-sans text-[13px] text-ink-2 cursor-pointer">
        <input
          type="checkbox"
          name="active"
          defaultChecked={initial.active}
          className="accent-accent"
        />
        Active (uncheck to hide this domain from lists and observations)
      </label>

      {display && (
        <div
          className={`font-mono text-[11px] uppercase tracking-wider ${
            display.ok ? 'text-ink-2' : 'text-accent'
          }`}
        >
          {display.ok ? 'Saved.' : display.error}
        </div>
      )}

      <div className="pt-2">
        <SaveButton />
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow block mb-1">{label}</span>
      {children}
    </label>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2.5 transition-colors"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}
