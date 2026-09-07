'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ASSET_PROFILE_KEYS, ASSET_PROFILE_LABELS, type AssetProfileKey } from '@jevi-ops/shared';
import { saveAssetFactsAction, type SaveResult } from './actions';

// The Facts rail: the asset's metadata as labelled key/value rows, with
// provenance when a fact carries it (source · observed date · verified),
// and an inline editor. Known profile keys get their labels and are offered
// as suggestions; any key is allowed — the vehicle agent writes rich facts
// through the API, a human types bare ones here, both render.

export interface FactRow {
  key: string;
  value: string;
  source?: string | null;
  observed_on?: string | null;
  verified?: boolean;
}

function labelFor(key: string): string {
  return (ASSET_PROFILE_LABELS as Record<string, string>)[key] ?? key.replace(/_/g, ' ');
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink text-bg px-3 py-1.5 font-sans font-semibold text-[11px] uppercase tracking-wider hover:bg-ink-2 transition-colors disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save facts'}
    </button>
  );
}

export function FactsEditor({ assetId, initial }: { assetId: string; initial: FactRow[] }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>(
    initial.map(({ key, value }) => ({ key, value })),
  );
  const [state, formAction] = useActionState<SaveResult | null, FormData>(
    async (prev, formData) => {
      const res = await saveAssetFactsAction(prev, formData);
      if (res.ok) setEditing(false);
      return res;
    },
    null,
  );

  if (!editing) {
    return (
      <div>
        {initial.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic">No facts yet — plate, VIN, insurance, serial…</p>
        ) : (
          initial.map((f) => (
            <div key={f.key} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-line/60 last:border-b-0">
              <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3 shrink-0">{labelFor(f.key)}</span>
              <span className="text-right min-w-0">
                <span className="font-sans text-[13px] text-ink break-words">{f.value}</span>
                {(f.source || f.observed_on || f.verified) && (
                  <span className="block font-mono text-[9px] text-ink-4">
                    {[f.verified ? '✓ verified' : null, f.source, f.observed_on].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors"
        >
          Edit facts
        </button>
        {state?.ok && <p className="mt-1 font-sans text-[12px] text-ink-2">{state.message}</p>}
      </div>
    );
  }

  const update = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setRows((r) => r.filter((_, j) => j !== i));
  const add = () => setRows((r) => [...r, { key: '', value: '' }]);
  const used = new Set(rows.map((r) => r.key));
  const suggestions = (ASSET_PROFILE_KEYS as readonly AssetProfileKey[]).filter((k) => !used.has(k));

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="facts" value={JSON.stringify(rows)} />
      <datalist id="fact-keys">
        {suggestions.map((k) => (
          <option key={k} value={k}>{ASSET_PROFILE_LABELS[k]}</option>
        ))}
      </datalist>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            list="fact-keys"
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder="key"
            className="w-[38%] border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink"
          />
          <input
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="value"
            className="flex-1 min-w-0 border border-line bg-surface px-2 py-1 font-sans text-[13px] text-ink"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label="Remove fact"
            className="font-mono text-[11px] text-ink-4 hover:text-accent px-1"
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="self-start font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2">
        + fact
      </button>
      <div className="flex items-center gap-3 mt-1">
        <SaveButton />
        <button
          type="button"
          onClick={() => {
            setRows(initial.map(({ key, value }) => ({ key, value })));
            setEditing(false);
          }}
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2"
        >
          Cancel
        </button>
      </div>
      {state && !state.ok && <p role="alert" className="font-sans text-[12px] text-accent">{state.error}</p>}
      <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
        Editing a fact the agent recorded replaces its provenance.
      </p>
    </form>
  );
}
