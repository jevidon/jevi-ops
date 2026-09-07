'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { SaveResult } from './actions';

// A form bound to a SaveResult server action: shows the outcome inline,
// keeps entered values on failure (the browser keeps them — we never
// reset), and disables the submit while pending. Server pages compose
// this instead of posting straight to the action, so a failed completion
// or reading is never silent.
//
// IDEMPOTENCY KEY (eventKey): identifies one OPERATION, not the form. It is
// minted on mount, kept across a failure or a double click (so the retry
// converges on the same event), and rotated after a confirmed success (so
// the next thing you record from the same mounted form is a new event —
// two readings in a row are two readings). Empty until hydration; a submit
// without a key lets the server mint one.

type Action = (prev: SaveResult | null, formData: FormData) => Promise<SaveResult>;

function mintKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
  // Attach a per-operation idempotency key (see header).
  eventKey?: boolean;
}) {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(action, null);
  const [key, setKey] = useState('');
  useEffect(() => {
    setKey(mintKey());
  }, []);
  useEffect(() => {
    if (state?.ok) setKey(mintKey());
  }, [state]);
  return (
    <form action={formAction} className={className}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {eventKey && <input type="hidden" name="event_key" value={key ? `web:${key}` : ''} />}
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
