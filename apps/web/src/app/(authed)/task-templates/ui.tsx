import type { ActionFailure } from './actions';

// Shared form vocabulary for the template library, editor and Use form.

// A field that failed validation swaps its hairline for the accent border, so
// "Check the marked fields" points at something visible. One border colour
// per state: two colour utilities on one element resolve by stylesheet order.
const fieldBase = 'block w-full mt-1 rounded border bg-transparent p-2.5 text-base text-ink focus:outline-accent';
export const fieldClass = `${fieldBase} border-line`;
export const field = (invalid?: unknown) => invalid ? `${fieldBase} border-accent` : fieldClass;
export const buttonClass = 'inline-flex min-h-11 items-center justify-center rounded border border-line px-4 py-2 text-sm hover:border-ink disabled:opacity-50';
export const primaryClass = `${buttonClass} bg-ink text-bg hover:bg-ink-2`;
export const failed = (error: string): ActionFailure => ({ ok: false, error });

export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="text-sm text-accent">{message}</p> : null;
}
