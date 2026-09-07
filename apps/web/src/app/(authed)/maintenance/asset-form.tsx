'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { Asset, AssetKind, AssetLifecycle } from '@/lib/api';
import { createAssetAction, updateAssetAction, type SaveResult } from './actions';
import type { DomainOption } from './item-form';

// Create/edit form for an asset. kind is display/grouping only; setting a
// meter unit is what unlocks the readings log + meter-cadence items. The
// unit locks once a reading exists (the API refuses a change) — relabelling
// km→mi would change what every historical number means.

const KINDS: Array<{ value: AssetKind; label: string }> = [
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'home', label: 'Home' },
  { value: 'device', label: 'Device' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'other', label: 'Other' },
];

const LIFECYCLES: Array<{ value: AssetLifecycle; label: string; hint: string }> = [
  { value: 'active', label: 'Active', hint: 'Generates tasks, attention, and reading nags.' },
  { value: 'stored', label: 'Stored', hint: 'Kept, not in use — schedules pause, history stays.' },
  { value: 'sold', label: 'Sold', hint: 'Gone. History stays for the record.' },
  { value: 'archived', label: 'Archived', hint: 'Hidden from the default list.' },
];

const field =
  'w-full border border-line bg-surface px-3 py-2 font-sans text-[14px] text-ink placeholder:text-ink-3';
const label = 'font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3';

function SubmitButton({ label: text }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink text-bg px-5 py-2.5 font-sans font-semibold text-[12px] uppercase tracking-wider hover:bg-ink-2 transition-colors disabled:opacity-50"
    >
      {pending ? 'Saving…' : text}
    </button>
  );
}

export function AssetForm({
  asset,
  domains,
  hasReadings = false,
  defaultDomainId,
}: {
  asset?: Asset;
  domains: DomainOption[];
  hasReadings?: boolean;
  defaultDomainId?: string | null;
}) {
  const editing = !!asset;
  const [state, formAction] = useActionState<SaveResult | null, FormData>(
    async (prev, formData) =>
      editing ? updateAssetAction(prev, formData) : createAssetAction(prev, formData),
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-[560px]">
      {editing && <input type="hidden" name="id" value={asset.id} />}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Name</span>
          <input name="name" required defaultValue={asset?.name ?? ''} placeholder="Bedroom air purifier" className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Kind</span>
          <select name="kind" defaultValue={asset?.kind ?? 'other'} className={field}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>
            Meter unit (km / mi / hours — blank = no meter){hasReadings ? ' · locked: readings exist' : ''}
          </span>
          <input
            name="meter_unit"
            defaultValue={asset?.meter_unit ?? ''}
            placeholder="km"
            readOnly={hasReadings}
            className={`${field} ${hasReadings ? 'opacity-60' : ''}`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Domain (optional · assigning promotes it into the domain)</span>
          <select name="domain_id" defaultValue={asset?.domain_id ?? defaultDomainId ?? ''} className={field}>
            <option value="">— unassigned (maintenance only) —</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      </div>

      {editing && (
        <label className="flex flex-col gap-1">
          <span className={label}>Lifecycle</span>
          <select name="lifecycle" defaultValue={asset.lifecycle} className={field}>
            {LIFECYCLES.map((l) => (
              <option key={l.value} value={l.value}>{l.label} — {l.hint}</option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className={label}>Notes</span>
        <textarea name="notes" rows={2} defaultValue={asset?.notes ?? ''} className={field} />
      </label>

      {state && !state.ok && <p role="alert" className="font-sans text-[12px] text-accent">{state.error}</p>}
      {state?.ok && <p role="status" className="font-sans text-[12px] text-ink-2">{state.message ?? 'Saved.'}</p>}

      <div>
        <SubmitButton label={editing ? 'Save' : 'Create asset'} />
      </div>
    </form>
  );
}
