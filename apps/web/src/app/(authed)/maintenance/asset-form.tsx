'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { Asset, AssetKind } from '@/lib/api';
import { createAssetAction, updateAssetAction, type SaveResult } from './actions';
import type { DomainOption } from './item-form';

// Create/edit form for an asset. kind is display/grouping only; setting a
// meter unit is what unlocks the readings log + meter-cadence items.

const KINDS: Array<{ value: AssetKind; label: string }> = [
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'home', label: 'Home' },
  { value: 'device', label: 'Device' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'other', label: 'Other' },
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

export function AssetForm({ asset, domains }: { asset?: Asset; domains: DomainOption[] }) {
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
          <span className={label}>Meter unit (km / mi / hours — blank = no meter)</span>
          <input name="meter_unit" defaultValue={asset?.meter_unit ?? ''} placeholder="km" className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Domain (optional)</span>
          <select name="domain_id" defaultValue={asset?.domain_id ?? ''} className={field}>
            <option value="">— none —</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={label}>Notes</span>
        <textarea name="notes" rows={2} defaultValue={asset?.notes ?? ''} className={field} />
      </label>

      {state && !state.ok && <p className="font-sans text-[12px] text-accent">{state.error}</p>}
      {state?.ok && <p className="font-sans text-[12px] text-ink-2">Saved.</p>}

      <div>
        <SubmitButton label={editing ? 'Save' : 'Create asset'} />
      </div>
    </form>
  );
}
