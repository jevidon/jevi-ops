'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { setCurrencyAction, setMeterStaleDaysAction } from './actions';
import type { SyncResult } from './actions';

// Settings → Maintenance. Two policies, each stated the same way everywhere
// it applies: the reading-staleness nag, and the household currency that
// spend totals are stated in (visits default to it; a foreign invoice is
// listed apart, never converted).

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider bg-ink text-bg hover:bg-ink-2 transition-colors disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

export function MaintenanceSettingsForm({ meterStaleDays, currency }: { meterStaleDays: number; currency: string }) {
  const [staleState, staleAction] = useActionState<SyncResult | null, FormData>(
    async (_prev, formData) => setMeterStaleDaysAction(formData),
    null,
  );
  const [currencyState, currencyAction] = useActionState<SyncResult | null, FormData>(
    async (_prev, formData) => setCurrencyAction(formData),
    null,
  );
  return (
    <div className="flex flex-col gap-4 py-2">
      <form action={staleAction} className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-4">
          <label className="flex flex-col gap-1 min-w-0">
            <span className="font-sans text-[14px] text-ink">Reading nag</span>
            <span className="font-sans text-[12px] text-ink-3 leading-relaxed">
              Days a metered asset with meter-based items may go without an odometer / hour reading
              before Attention asks for one. Stored, sold, and archived assets never ask.
            </span>
            <span className="mt-1 flex items-center gap-2">
              <input
                type="number"
                name="meter_stale_days"
                min={1}
                max={365}
                defaultValue={meterStaleDays}
                className="w-24 border border-line bg-surface px-3 py-2 font-sans text-[14px] text-ink"
              />
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">days</span>
            </span>
          </label>
          <SaveButton />
        </div>
        {staleState && (
          <p className={`font-sans text-[12px] ${staleState.ok ? 'text-ink-2' : 'text-accent'}`}>{staleState.message}</p>
        )}
      </form>

      <form action={currencyAction} className="flex flex-col gap-2 pt-4 border-t border-line/60">
        <div className="flex items-end justify-between gap-4">
          <label className="flex flex-col gap-1 min-w-0">
            <span className="font-sans text-[14px] text-ink">Household currency</span>
            <span className="font-sans text-[12px] text-ink-3 leading-relaxed">
              What spend totals are stated in. Visits use it unless you say otherwise; an invoice in
              another currency is listed beside the total, never converted or silently added.
            </span>
            <span className="mt-1 flex items-center gap-2">
              <input
                type="text"
                name="currency"
                maxLength={3}
                defaultValue={currency}
                placeholder="NZD"
                className="w-24 border border-line bg-surface px-3 py-2 font-sans text-[14px] text-ink uppercase"
              />
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">ISO 4217</span>
            </span>
          </label>
          <SaveButton />
        </div>
        {currencyState && (
          <p className={`font-sans text-[12px] ${currencyState.ok ? 'text-ink-2' : 'text-accent'}`}>{currencyState.message}</p>
        )}
      </form>
    </div>
  );
}
