'use client';

import { useActionState, useState } from 'react';
import { updateTimezoneAction } from './actions';
import type { SyncResult } from './actions';

// Curated set of common IANA timezones. The free-text input below
// accepts any zone the runtime knows about, so the dropdown is just
// the convenient-default surface, not an allowlist.
const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Athens',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Dubai',
  'Australia/Sydney',
  'UTC',
];

export function TimezoneForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState<SyncResult | null, FormData>(
    async (_prev, formData) => updateTimezoneAction(formData),
    null,
  );

  // Custom input wins if non-empty — same pattern as the routine goal
  // form. Dropdown defaults to the current value if it's in the list;
  // otherwise drops to blank and the custom input shows the value.
  const presetMatch = COMMON_TIMEZONES.includes(current) ? current : '';
  const [preset, setPreset] = useState(presetMatch);
  const [custom, setCustom] = useState(presetMatch ? '' : current);
  const effective = custom.trim() || preset;
  const dirty = effective && effective !== current;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="font-sans text-[13px] text-ink-2 leading-relaxed">
        Used everywhere the app needs to know &ldquo;what day is it&rdquo; — task due
        dates, routine completions, the daily-summary cron, photo
        timestamps, the activity log. Server time doesn&rsquo;t enter into it;
        timestamps are stored in UTC and converted at the edges.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Common timezones</span>
          <select
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              if (e.target.value) setCustom('');
            }}
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            <option value="">— pick one —</option>
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Or custom IANA name</span>
          <input
            type="text"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              if (e.target.value) setPreset('');
            }}
            placeholder="e.g. America/Boise"
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </label>
      </div>

      <input type="hidden" name="timezone" value={effective} />

      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          Current: <span className="text-ink-2">{current}</span>
        </span>
        <button
          type="submit"
          disabled={!dirty || pending}
          className="ml-auto bg-ink hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2 transition-colors"
        >
          {pending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {state && (
        <div
          className={`font-mono text-[11px] uppercase tracking-wider ${
            state.ok ? 'text-ink-2' : 'text-accent'
          }`}
        >
          {state.message}
        </div>
      )}
    </form>
  );
}
