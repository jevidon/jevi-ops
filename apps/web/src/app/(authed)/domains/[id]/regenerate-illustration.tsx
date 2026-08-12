'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  regenerateIllustrationAction,
  type RegenerateIllustrationResult,
} from './actions';

// "Redraw" button for the domain's board illustration. The API composes
// a fresh engraving via the configured model (falling back to the
// procedural library when the model is unavailable or its output fails
// the sanitizer) and persists it; the action revalidates this page so
// the preview above updates in place.

export function RegenerateIllustration({
  domainId,
  current,
  tz,
}: {
  domainId: string;
  current: { source: 'llm' | 'procedural'; generated_at: string } | null;
  tz: string;
}) {
  const [state, formAction] = useActionState<RegenerateIllustrationResult | null, FormData>(
    regenerateIllustrationAction,
    null,
  );
  // Prefer the freshly-returned stamp over the load-time prop, same
  // pattern as MarkShipped — revalidation will catch the prop up.
  const effective = state?.ok
    ? { source: state.source, generated_at: state.generated_at }
    : current;
  const meta = effective
    ? `${effective.source === 'llm' ? 'Drawn by the model' : 'Library motif'} · ${new Date(
        effective.generated_at,
      ).toLocaleString('en-US', {
        timeZone: tz,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`
    : 'Library motif · not yet drawn';

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <form action={formAction}>
        <input type="hidden" name="id" value={domainId} />
        <SubmitButton />
      </form>
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
        {meta}
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
      {pending ? 'Redrawing…' : 'Redraw illustration'}
    </button>
  );
}
