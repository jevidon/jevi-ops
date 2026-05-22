'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createTaskAction } from './actions';

// Inline add. Submits → server action → revalidate. On success the form
// clears so you can keep typing the next one without clicking.

export function AddTaskForm() {
  const [state, formAction, pending] = useActionState(createTaskAction, {});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pending && !state?.error) {
      // After a successful submit, reset & refocus.
      inputRef.current?.form?.reset();
      inputRef.current?.focus();
    }
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
