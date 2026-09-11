'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ASSET_PROFILE_KEYS, ASSET_PROFILE_LABELS, type AssetProfileKey } from '@jevi-ops/shared';
import { saveAssetFactsAction, type SaveResult } from './actions';
import { ReadableValues } from '@/components/onboarding/ChangeReview';

const guidedVehicleKeys = new Set(['vehicle_preferences', 'vehicle_answer_states', 'vehicle_ownership_evidence', 'installed_equipment', 'known_issues']);
const vehicleLabels: Record<string, string> = { vehicle_preferences: 'Preferences', vehicle_answer_states: 'Information coverage', vehicle_ownership_evidence: 'Ownership evidence', installed_equipment: 'Installed equipment', known_issues: 'Known issues' };
const vehicleValues: Record<string, string> = { service_provider: 'Use a service provider', simple_checks: 'Do simple checks', some_diy: 'Do some work myself', mostly_diy: 'Do most work myself', actively_planning: 'Actively planning', maybe_later: 'Maybe later', none_now: 'None now', not_asked: 'Not yet asked', not_applicable: 'Not applicable', service_reminders: 'Service reminders', maintain_records: 'Maintain records', learn_maintenance: 'Understand maintenance', plan_improvements: 'Plan improvements', state: 'Current state', history: 'History and documents', tracking: 'Dates and responsibilities' };
function readableVehicleValue(value: unknown): unknown {
  if (typeof value === 'string') return vehicleValues[value] ?? value;
  if (Array.isArray(value)) return value.map(readableVehicleValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readableVehicleValue(item)]));
  return value;
}

// The Facts rail: the asset's metadata as labelled key/value rows, with
// provenance when a fact carries it (source · observed date · verified),
// and an inline editor. Known profile keys get their labels and are offered
// as suggestions; any key is allowed — the vehicle agent writes rich facts
// through the API, a human types bare ones here, both render.
//
// The editor only ever touches what you change: it posts the rows AND the
// originals it rendered from, and the action sends a per-key patch (see
// actions.ts). Structured values (an object with no scalar `value`) are
// shown read-only and are not editable here — round-tripping them through
// a text box would flatten them to a string.

export interface FactRow {
  key: string;
  value: string;
  // The stored value, verbatim — what the patch's `expected` carries.
  raw: unknown;
  source?: string | null;
  observed_on?: string | null;
  verified?: boolean;
  // No scalar to edit: rendered, never editable here.
  structured?: boolean;
}

function labelFor(key: string): string {
  return vehicleLabels[key] ?? (ASSET_PROFILE_LABELS as Record<string, string>)[key] ?? key.replace(/_/g, ' ');
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
  const editable = initial.filter((f) => !f.structured);
  const structured = initial.filter((f) => f.structured);
  const original = Object.fromEntries(editable.map((f) => [f.key, f.raw]));
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>(
    editable.map(({ key, value }) => ({ key, value })),
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
              <div className="text-right min-w-0">
                {f.structured && guidedVehicleKeys.has(f.key)
                  ? <div className="text-left"><ReadableValues value={readableVehicleValue(f.raw)} /></div>
                  : <span className={`font-sans text-[13px] text-ink break-words ${f.structured ? 'font-mono text-[11px]' : ''}`}>{f.value}</span>}
                {(f.source || f.observed_on || f.verified || f.structured) && (
                  <span className="block font-mono text-[9px] text-ink-4">
                    {f.structured
                      ? guidedVehicleKeys.has(f.key) ? 'Update through Complete vehicle details' : 'structured · edit via API'
                      : [f.verified ? '✓ verified' : null, f.source, f.observed_on].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
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
      <input type="hidden" name="original" value={JSON.stringify(original)} />
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
      {structured.length > 0 && (
        <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
          Separate records: {structured.map((f) => labelFor(f.key)).join(', ')}. Use Complete vehicle details for vehicle information.
        </p>
      )}
      <div className="flex items-center gap-3 mt-1">
        <SaveButton />
        <button
          type="button"
          onClick={() => {
            setRows(editable.map(({ key, value }) => ({ key, value })));
            setEditing(false);
          }}
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2"
        >
          Cancel
        </button>
      </div>
      {state && !state.ok && <p role="alert" className="font-sans text-[12px] text-accent">{state.error}</p>}
      <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
        Only what you change is saved. Editing a fact the agent recorded replaces its provenance.
      </p>
    </form>
  );
}
