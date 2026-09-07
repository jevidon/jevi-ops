'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { setMeterStaleDaysAction } from './actions';
import type { SyncResult } from './actions';

// Settings → Maintenance. The reading-staleness policy: one number, stated
// the same way everywhere it applies (the attention nag, the /maintenance
// masthead, the asset page).

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

export function MaintenanceSettingsForm({ meterStaleDays }: { meterStaleDays: number }) {
  const [state, formAction] = useActionState<SyncResult | null, FormData>(
    async (_prev, formData) => setMeterStaleDaysAction(formData),
    null,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2 py-2">
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
      {state && (
        <p className={`font-sans text-[12px] ${state.ok ? 'text-ink-2' : 'text-accent'}`}>{state.message}</p>
      )}
    </form>
  );
}
