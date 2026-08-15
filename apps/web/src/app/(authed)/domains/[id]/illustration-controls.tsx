'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  commitIllustrationAction,
  discardIllustrationAction,
  draftIllustrationAction,
  type IllustrationActionResult,
} from './actions';

// Candidate controls for the domain's board illustration. Drawing a
// candidate never touches the saved art — the server puts the render in
// the draft slot and the page revalidates to show it beside the current
// drawing. Keep promotes the candidate; Discard clears it. The saved
// illustration only ever changes on Keep.

export function IllustrationControls({
  domainId,
  hasDraft,
}: {
  domainId: string;
  hasDraft: boolean;
}) {
  const [draftState, draftAction] = useActionState<IllustrationActionResult | null, FormData>(
    draftIllustrationAction,
    null,
  );
  const [commitState, commitAction] = useActionState<IllustrationActionResult | null, FormData>(
    commitIllustrationAction,
    null,
  );
  const [discardState, discardAction] = useActionState<IllustrationActionResult | null, FormData>(
    discardIllustrationAction,
    null,
  );
  const errors = [draftState, commitState, discardState]
    .filter((s): s is { ok: false; error: string } => s?.ok === false)
    .map((s) => s.error);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <form action={draftAction}>
        <input type="hidden" name="id" value={domainId} />
        <ActionButton
          label={hasDraft ? 'Redraw candidate' : 'Draw candidate'}
          pendingLabel="Drawing…"
        />
      </form>
      {hasDraft && (
        <>
          <form action={commitAction}>
            <input type="hidden" name="id" value={domainId} />
            <ActionButton label="Keep candidate" pendingLabel="Keeping…" emphasis />
          </form>
          <form action={discardAction}>
            <input type="hidden" name="id" value={domainId} />
            <ActionButton label="Discard" pendingLabel="Discarding…" />
          </form>
        </>
      )}
      {errors.map((e, i) => (
        <span key={i} className="font-mono text-[10px] uppercase tracking-wider text-accent">
          {e}
        </span>
      ))}
    </div>
  );
}

function ActionButton({
  label,
  pendingLabel,
  emphasis = false,
}: {
  label: string;
  pendingLabel: string;
  emphasis?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`border font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 transition-colors disabled:opacity-40 ${
        emphasis
          ? 'border-accent text-accent-ink hover:bg-accent-bg'
          : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
      }`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
