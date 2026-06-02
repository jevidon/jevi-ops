'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  setResurfaceWeightAction,
  type ResurfaceKind,
  type ResurfaceResult,
} from '@/app/(authed)/library/_actions/resurface';

// Per-item resurfacing control. Click to cycle through four states:
//
//   1.0 → 2.0 → 5.0 → 0 → 1.0
//   Normal · Boost 2× · Boost 5× · Excluded · Normal
//
// The cycle is deliberately small. The Today picker only uses the weight
// as a probability multiplier — finer granularity than "normal / a bit /
// a lot / never" doesn't change the user-visible behavior in any way you
// can feel, but it does turn the button into a slider, which we don't
// need. Reset to 1.0 by cycling through 0 (one extra click).

type State = 'normal' | 'boost2' | 'boost5' | 'excluded';

function weightToState(w: number | undefined): State {
  if (w === undefined || w === 1) return 'normal';
  if (w === 0) return 'excluded';
  if (w >= 5) return 'boost5';
  if (w >= 2) return 'boost2';
  // Anything else (0.5, 0.25, etc.) we'll show as "normal" — there's no
  // current UI for setting those, they can only come from manual SQL.
  return 'normal';
}

const NEXT_WEIGHT: Record<State, number> = {
  normal: 2,
  boost2: 5,
  boost5: 0,
  excluded: 1,
};

const LABEL: Record<State, string> = {
  normal: 'Normal',
  boost2: '★ Boost 2×',
  boost5: '★★ Boost 5×',
  excluded: '✕ Excluded',
};

// Accent for boosted, ink-3 for excluded — keeps the visual hierarchy
// honest. Boosted items are the ones the user wants surfaced more often,
// so they get the visual weight. Excluded is dimmer because that's its
// nature: hidden, out of rotation.
const CLASSES: Record<State, string> = {
  normal: 'border-line text-ink-3 hover:border-ink-2 hover:text-ink-2',
  boost2: 'border-accent text-accent hover:border-accent hover:text-accent',
  boost5: 'border-accent bg-accent text-bg hover:bg-accent hover:text-bg',
  excluded: 'border-line text-ink-3/60 hover:border-ink-2 hover:text-ink-3',
};

export function BoostButton({
  kind,
  id,
  weight,
}: {
  kind: ResurfaceKind;
  id: string;
  weight: number | undefined;
}) {
  // Track the current weight locally so the button updates immediately on
  // click without waiting for revalidation to round-trip. The server action
  // is the source of truth, but optimistic local state keeps the UI snappy.
  const [localWeight, setLocalWeight] = useState<number>(weight ?? 1);

  // Sync local state when prop changes (e.g. parent re-renders after revalidation).
  useEffect(() => {
    setLocalWeight(weight ?? 1);
  }, [weight]);

  const [state, formAction] = useActionState<ResurfaceResult | null, FormData>(
    setResurfaceWeightAction,
    null,
  );

  // On successful action, sync local to server.
  useEffect(() => {
    if (state?.ok) setLocalWeight(state.weight);
  }, [state]);

  const currentState = weightToState(localWeight);
  const nextWeight = NEXT_WEIGHT[currentState];

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="weight" value={nextWeight} />
      <SubmitButton state={currentState} />
      {state?.ok === false && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
          {state.error}
        </span>
      )}
    </form>
  );
}

function SubmitButton({ state }: { state: State }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title="Cycle resurface weight"
      className={`border font-mono text-[10px] uppercase tracking-wider px-2 py-1 transition-colors disabled:opacity-50 ${CLASSES[state]}`}
    >
      {pending ? '…' : LABEL[state]}
    </button>
  );
}
