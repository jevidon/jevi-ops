'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { markShippedAction, type MarkShippedResult } from './actions';

// One-tap "I shipped something" stamp for domains whose work happens
// outside the dashboard. Shows the last stamp (or "never") and lets the
// user bump it to now. The cadence helper takes MAX of this and the
// latest content_items.published_at, so this button works whether or
// not the user also logs content_items.

export function MarkShipped({
  domainId,
  lastShippedAt,
  tz,
}: {
  domainId: string;
  lastShippedAt: string | null;
  tz: string;
}) {
  const [state, formAction] = useActionState<MarkShippedResult | null, FormData>(
    markShippedAction,
    null,
  );
  // After a successful stamp, prefer the freshly-returned timestamp over
  // the prop (the prop reflects the load-time value; the form revalidates
  // the page so the prop will catch up on the next render but the chip
  // shouldn't flicker through the old value in the meantime).
  const effective = state?.ok ? state.at : lastShippedAt;
  const formatted = effective
    ? new Date(effective).toLocaleString('en-US', {
        timeZone: tz,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <form action={formAction}>
        <input type="hidden" name="id" value={domainId} />
        <SubmitButton />
      </form>
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
        {formatted ? `Last shipped ${formatted}` : 'Never marked'}
      </span>
      {state?.ok === false && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
          {state.error}
        </span>
      )}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 transition-colors disabled:opacity-40"
    >
      {pending ? 'Stamping…' : 'Mark shipped now'}
    </button>
  );
}
