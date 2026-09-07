'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { MaintenanceItem } from '@/lib/api';
import { createItemAction, updateItemAction, type SaveResult } from './actions';

// Create/edit form for a maintenance item. Client component (useActionState
// for inline errors, local state for the asset→meter affordance); the data
// arrives as props from the server page.

export interface AssetOption {
  id: string;
  name: string;
  meter_unit: string | null;
}
export interface DomainOption {
  id: string;
  name: string;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink text-bg px-5 py-2.5 font-sans font-semibold text-[12px] uppercase tracking-wider hover:bg-ink-2 transition-colors disabled:opacity-50"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

const field =
  'w-full border border-line bg-surface px-3 py-2 font-sans text-[14px] text-ink placeholder:text-ink-3';
const label = 'font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3';

export function ItemForm({
  item,
  assets,
  domains,
}: {
  item?: MaintenanceItem;
  assets: AssetOption[];
  domains: DomainOption[];
}) {
  const editing = !!item;
  const [state, formAction] = useActionState<SaveResult | null, FormData>(
    async (prev, formData) => (editing ? updateItemAction(prev, formData) : createItemAction(prev, formData)),
    null,
  );
  const [assetId, setAssetId] = useState(item?.asset_id ?? '');
  const selectedAsset = assets.find((a) => a.id === assetId);
  const meterUnit = selectedAsset?.meter_unit ?? null;

  const dateUnit = item?.interval_days != null ? 'days' : 'months';
  const dateInterval = item?.interval_days ?? item?.interval_months ?? '';

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-[560px]">
      {editing && <input type="hidden" name="id" value={item.id} />}

      <label className="flex flex-col gap-1">
        <span className={label}>Name</span>
        <input
          name="name"
          required
          defaultValue={item?.name ?? ''}
          placeholder="Replace air purifier filters"
          className={field}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Asset (optional)</span>
          <select
            name="asset_id"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className={field}
          >
            <option value="">— none —</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.meter_unit ? ` (${a.meter_unit})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Domain</span>
          <select name="domain_id" defaultValue={item?.domain_id ?? ''} className={field}>
            <option value="">— inherit from asset / Inbox —</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Date cadence (optional)</span>
          <div className="flex gap-2">
            <input
              type="number"
              name="date_interval"
              min="1"
              defaultValue={dateInterval}
              placeholder="3"
              className={`${field} w-24`}
            />
            <select name="date_unit" defaultValue={dateUnit} className={field}>
              <option value="months">months</option>
              <option value="days">days</option>
            </select>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>
            Meter cadence{meterUnit ? ` (${meterUnit})` : ''} {meterUnit ? '' : '— needs a metered asset'}
          </span>
          <input
            type="number"
            name="interval_meter"
            min="0"
            step="any"
            disabled={!meterUnit}
            defaultValue={item?.interval_meter ?? ''}
            placeholder="5000"
            className={`${field} disabled:opacity-40`}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Surface ahead (days)</span>
          <input
            type="number"
            name="lead_days"
            min="0"
            defaultValue={item?.lead_days ?? 14}
            className={field}
          />
        </label>
        {meterUnit && (
          <label className="flex flex-col gap-1">
            <span className={label}>Surface ahead ({meterUnit}, blank = 10%)</span>
            <input
              type="number"
              name="lead_meter"
              min="0"
              step="any"
              defaultValue={item?.lead_meter ?? ''}
              className={field}
            />
          </label>
        )}
      </div>

      {!editing && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={label}>Last done on (seeds the schedule)</span>
            <input type="date" name="last_completed_on" className={field} />
          </label>
          {meterUnit && (
            <label className="flex flex-col gap-1">
              <span className={label}>…at reading ({meterUnit})</span>
              <input type="number" name="last_completed_meter" min="0" step="any" className={field} />
            </label>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className={label}>Notes</span>
        <textarea name="notes" rows={2} defaultValue={item?.notes ?? ''} className={field} />
      </label>

      {state && !state.ok && (
        <p className="font-sans text-[12px] text-accent">{state.error}</p>
      )}
      {state?.ok && <p className="font-sans text-[12px] text-ink-2">Saved.</p>}

      <div>
        <SubmitButton label={editing ? 'Save' : 'Create item'} />
      </div>
    </form>
  );
}
