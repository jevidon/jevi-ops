'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createTaskAction } from './actions';

// Inline add. Submits → server action → revalidate. On success the form
// clears so you can keep typing the next one without clicking.

export function AddTaskForm() {
  const [state, formAction, pending] = useActionState(createTaskAction, {});
  const inputRef = useRef<HTMLInputElement>(null);
  // Track the previous pending value so we only fire the reset/refocus when
  // pending transitions from true → false (i.e. a submit JUST completed).
  // Without this, the effect fires on initial mount — and because the input
  // sits at the bottom of the Today page, focusing it would scroll the
  // whole page down on every load.
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      // A submit just completed successfully — clear and refocus for the
      // next entry. preventScroll: true so we don't yank the page; the
      // user is already looking at this input since they just submitted
      // from it.
      inputRef.current?.form?.reset();
      inputRef.current?.focus({ preventScroll: true });
    }
    wasPending.current = pending;
  }, [state, pending]);

  return (
    <form action={formAction} className="flex items-center gap-2 mt-2">
      <span className="text-ink-3 text-[14px] select-none" aria-hidden>+</span>
      <input
        ref={inputRef}
        type="text"
        name="title"
        required
        placeholder="Add a task…"
        disabled={pending}
        autoComplete="off"
        className="flex-1 bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] placeholder:text-ink-3/70 text-ink"
      />
      {state?.error && (
        <span className="font-mono text-[10px] uppercase text-accent">{state.error}</span>
      )}
    </form>
  );
}
