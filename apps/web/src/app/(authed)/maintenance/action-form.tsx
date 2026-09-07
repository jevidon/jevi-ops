'use client';

import { useActionState, useId } from 'react';
import { useFormStatus } from 'react-dom';
import type { SaveResult } from './actions';

// A form bound to a SaveResult server action: shows the outcome inline,
// keeps entered values on failure (the browser keeps them — we never
// reset), and disables the submit while pending. Server pages compose
// this instead of posting straight to the action, so a failed completion
// or reading is never silent.

type Action = (prev: SaveResult | null, formData: FormData) => Promise<SaveResult>;

function SubmitButton({ label, variant, pendingLabel }: { label: string; variant: 'solid' | 'ghost' | 'quiet'; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  const cls =
    variant === 'solid'
      ? 'bg-ink text-bg px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider hover:bg-ink-2 transition-colors disabled:opacity-50'
      : variant === 'ghost'
        ? 'border border-line-strong px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider text-ink-2 hover:text-ink hover:border-ink-2 transition-colors disabled:opacity-50'
        : 'font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-accent transition-colors disabled:opacity-50';
  return (
    <button type="submit" disabled={pending} className={cls}>
      {pending ? (pendingLabel ?? 'Saving…') : label}
    </button>
  );
}

export function ActionForm({
  action,
  hidden = {},
  submit,
  variant = 'solid',
  pendingLabel,
  className = '',
  children,
  eventKey = false,
}: {
  action: Action;
  hidden?: Record<string, string>;
  submit: string;
  variant?: 'solid' | 'ghost' | 'quiet';
  pendingLabel?: string;
  className?: string;
  children?: React.ReactNode;
  // Attach a per-render idempotency key so a double submit is one event.
  eventKey?: boolean;
}) {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(action, null);
  const key = useId();
  return (
    <form action={formAction} className={className}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {eventKey && <input type="hidden" name="event_key" value={`web:${key}:${hidden.id ?? hidden.asset_id ?? ''}`} />}
      {children}
      <SubmitButton label={submit} variant={variant} pendingLabel={pendingLabel} />
      {state && (
        <span
          role={state.ok ? 'status' : 'alert'}
          className={`block basis-full mt-2 font-sans text-[12px] ${state.ok ? 'text-ink-2' : 'text-accent'}`}
        >
          {state.ok ? state.message ?? 'Saved.' : state.error}
        </span>
      )}
    </form>
  );
}
