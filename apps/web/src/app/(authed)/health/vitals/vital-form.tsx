'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createMetricAction, type SaveResult } from './actions';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';
import { DateTimeInput } from '@/components/DateTimeInput';

// Quick vital entry. Metric dropdown drives the unit hint + whether to
// show the secondary value field (BP is the only common dual-value one).

const METRIC_OPTIONS = [
  { value: 'weight', label: 'Weight', unit: 'lbs', dual: false },
  { value: 'bp', label: 'Blood pressure', unit: 'mmHg', dual: true },
  { value: 'hr_resting', label: 'Resting HR', unit: 'bpm', dual: false },
  { value: 'hr_avg', label: 'Average HR', unit: 'bpm', dual: false },
  { value: 'spo2_avg', label: 'SpO₂', unit: '%', dual: false },
  { value: 'temperature', label: 'Temperature', unit: '°F', dual: false },
  { value: 'glucose', label: 'Glucose', unit: 'mg/dL', dual: false },
  { value: 'hrv_overnight', label: 'HRV', unit: 'ms', dual: false },
  { value: 'sleep_duration', label: 'Sleep duration', unit: 'min', dual: false },
];

function nowLocalString(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function VitalForm() {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(createMetricAction, null);
  const display = useTransientSaveResult(state);
  const [metric, setMetric] = useState('weight');
  const selected = METRIC_OPTIONS.find((o) => o.value === metric) ?? METRIC_OPTIONS[0]!;

  return (
    <form action={formAction} className="flex flex-col gap-3 mt-4 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Metric</span>
          <select
            name="metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            {METRIC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">When</span>
          <DateTimeInput
            name="measured_at"
            defaultValue={nowLocalString()}
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">
            {selected.dual ? 'Systolic' : 'Value'}
          </span>
          <input
            type="number"
            name="value"
            step="any"
            inputMode="decimal"
            required
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </label>
        {selected.dual && (
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Diastolic</span>
            <input
              type="number"
              name="value_secondary"
              step="any"
              inputMode="decimal"
              className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Unit</span>
          <input
            type="text"
            name="unit"
            defaultValue={selected.unit}
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="eyebrow">Notes (optional)</span>
        <input
          type="text"
          name="notes"
          placeholder="e.g., at home, post-coffee, sitting"
          className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-3/60"
        />
      </label>

      <div className="flex items-center gap-3">
        <SaveButton />
        {display?.ok === false && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{display.error}</span>
        )}
        {display?.ok === true && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">✓ Logged</span>
        )}
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2 transition-colors"
    >
      {pending ? 'Saving…' : 'Log vital'}
    </button>
  );
}
