'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { addAnnotationAction, type ActionResult } from './actions';

// Annotation entry — short textarea, submits via server action. Clears on
// success so the user can chain thoughts. The quote ID is hidden in the
// form payload so the action knows what to attach to.

export function AddAnnotationForm({ quoteId }: { quoteId: string }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    addAnnotationAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      textareaRef.current?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="quoteId" value={quoteId} />
      <textarea
        ref={textareaRef}
        name="body"
        required
        rows={3}
        placeholder="Add a thought on this quote…"
        className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink resize-y placeholder:text-ink-3/70"
      />
      <div className="flex items-center justify-between gap-3">
        {state && !state.ok ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
            {state.error}
          </span>
        ) : (
          <span aria-hidden />
        )}
        <SubmitButton />
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
      className="bg-ink hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[12px] uppercase tracking-wider px-4 py-2 transition-colors"
    >
      {pending ? 'Saving…' : 'Add thought'}
    </button>
  );
}
