'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { MaintenanceItem, MaintenancePolicy } from '@/lib/api';
import { createItemAction, updateItemAction, type SaveResult } from './actions';

// Create/edit form for a maintenance item. Client component (useActionState
// for inline errors, local state for the asset→meter and policy
// affordances); the data arrives as props from the server page.
//
// The form only carries what it owns. The API re-derives an axis only when
// that axis's interval VALUE changes, so a name-only save never moves a
// due date (0048).

export interface AssetOption {
  id: string;
  name: string;
  meter_unit: string | null;
}
export interface DomainOption {
  id: string;
  name: string;
}

const POLICIES: Array<{ value: MaintenancePolicy; label: string; hint: string }> = [
  { value: 'interval', label: 'Interval', hint: 'Re-anchors from each completion — filters, oil, servicing.' },
  { value: 'expiry', label: 'Expiry', hint: 'Rego, WoF, insurance: completing records the newly issued expiry.' },
  { value: 'prepaid_meter', label: 'Prepaid distance', hint: 'RUC: completing records the purchased end distance.' },
  { value: 'on_condition', label: 'On condition', hint: 'No interval: an inspection records a finding and a next review.' },
];

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
  const [policy, setPolicy] = useState<MaintenancePolicy>(item?.policy ?? 'interval');
  const selectedAsset = assets.find((a) => a.id === assetId);
  const meterUnit = selectedAsset?.meter_unit ?? null;

  const dateUnit = item?.interval_days != null ? 'days' : 'months';
  const dateInterval = item?.interval_days ?? item?.interval_months ?? '';
  const showDateInterval = policy !== 'on_condition';
  const showMeterInterval = policy === 'interval' || policy === 'prepaid_meter';

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-[560px]">
      {editing && <input type="hidden" name="id" value={item.id} />}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Name</span>
          <input name="name" required defaultValue={item?.name ?? ''} placeholder="Replace air purifier filters" className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>System (grouping, optional)</span>
          <input name="system" defaultValue={item?.system ?? ''} placeholder="Fluids · Brakes · Legal" className={field} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Asset (optional)</span>
          <select name="asset_id" value={assetId} onChange={(e) => setAssetId(e.target.value)} className={field}>
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

      <label className="flex flex-col gap-1">
        <span className={label}>Policy</span>
        <select name="policy" value={policy} onChange={(e) => setPolicy(e.target.value as MaintenancePolicy)} className={field}>
          {POLICIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <span className="font-sans text-[12px] text-ink-3">{POLICIES.find((p) => p.value === policy)?.hint}</span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        {showDateInterval && (
          <label className="flex flex-col gap-1">
            <span className={label}>{policy === 'expiry' ? 'Renewal length (fallback)' : 'Date cadence (optional)'}</span>
            <div className="flex gap-2">
              <input type="number" name="date_interval" min="1" defaultValue={dateInterval} placeholder="3" className={`${field} w-24`} />
              <select name="date_unit" defaultValue={dateUnit} className={field}>
                <option value="months">months</option>
                <option value="days">days</option>
              </select>
            </div>
          </label>
        )}
        {showMeterInterval && (
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
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Surface ahead (days)</span>
          <input type="number" name="lead_days" min="0" defaultValue={item?.lead_days ?? 14} className={field} />
        </label>
        {meterUnit && (
          <label className="flex flex-col gap-1">
            <span className={label}>Surface ahead ({meterUnit}, blank = 10%)</span>
            <input type="number" name="lead_meter" min="0" step="any" defaultValue={item?.lead_meter ?? ''} className={field} />
          </label>
        )}
      </div>

      {!editing && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={label}>Last done on (baseline evidence)</span>
            <input type="date" name="last_completed_on" className={field} />
          </label>
          {meterUnit && (
            <label className="flex flex-col gap-1">
              <span className={label}>…at reading ({meterUnit})</span>
              <input type="number" name="last_completed_meter" min="0" step="any" className={field} />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className={label}>Or pin next due (date)</span>
            <input type="date" name="next_due_date" className={field} />
          </label>
          {meterUnit && (
            <label className="flex flex-col gap-1">
              <span className={label}>Or pin next due ({meterUnit})</span>
              <input type="number" name="next_due_meter" min="0" step="any" className={field} />
            </label>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className={label}>Notes (spec, part numbers, provider)</span>
        <textarea name="notes" rows={2} defaultValue={item?.notes ?? ''} className={field} />
      </label>

      {state && !state.ok && <p role="alert" className="font-sans text-[12px] text-accent">{state.error}</p>}
      {state?.ok && <p role="status" className="font-sans text-[12px] text-ink-2">{state.message ?? 'Saved.'}</p>}

      <div>
        <SubmitButton label={editing ? 'Save' : 'Create item'} />
      </div>
    </form>
  );
}
