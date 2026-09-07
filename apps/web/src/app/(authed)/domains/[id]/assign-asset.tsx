'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { assignAssetAction, type AssignAssetResult } from './actions';

// "Assign existing…" — promote an unassigned asset into this domain. Sits in
// the Assets section's action slot; renders nothing when there's nothing
// unassigned to offer.

export function AssignAsset({
  domainId,
  unassigned,
}: {
  domainId: string;
  unassigned: Array<{ id: string; name: string; kind: string }>;
}) {
  const [state, formAction] = useActionState<AssignAssetResult | null, FormData>(assignAssetAction, null);
  if (unassigned.length === 0) return null;
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="domain_id" value={domainId} />
      <select
        name="asset_id"
        defaultValue=""
        className="h-[26px] max-w-[200px] border border-line-strong bg-bg px-2 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-2"
        aria-label="Assign an existing asset"
      >
        <option value="">Assign existing…</option>
        {unassigned.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {a.kind}
          </option>
        ))}
      </select>
      <Submit />
      {state?.ok === false && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{state.error}</span>
      )}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-[26px] px-[9px] rounded border border-line-strong font-mono text-[9.5px] font-semibold uppercase tracking-[0.07em] text-ink-3 hover:border-ink-3 hover:text-ink transition-colors disabled:opacity-40"
    >
      {pending ? '…' : 'Assign'}
    </button>
  );
}
