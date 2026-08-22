'use client';

import { useActionState, useState } from 'react';
import { updateFrameUrlAction } from './actions';
import type { SyncResult } from './actions';

// Frame panel image URL (migration 0045). One URL field: the Agenda's
// Frame panel loads this client-side (with a periodic cache-buster), so a
// tailnet address like http://100.101.65.121/api/current_image works as
// long as the browser is on the same network. Clearing hides the panel.

export function FrameUrlForm({ current }: { current: string | null }) {
  const [state, formAction, pending] = useActionState<SyncResult | null, FormData>(
    async (_prev, formData) => updateFrameUrlAction(formData),
    null,
  );
  const [value, setValue] = useState(current ?? '');
  const dirty = value.trim() !== (current ?? '');

  return (
    <form action={formAction} className="flex flex-col gap-2 mb-4 pb-4 border-b border-line">
      <label className="flex flex-col gap-1">
        <span className="eyebrow">Frame image URL</span>
        <input
          type="text"
          name="agenda_image_url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="http://100.101.65.121/api/current_image — blank hides the Frame panel"
          spellCheck={false}
          autoComplete="off"
          className="w-full max-w-xl bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-mono text-[13px] text-ink placeholder:text-ink-3"
        />
      </label>
      <div className="flex items-center gap-3">
        <span className="font-sans text-[12px] text-ink-3">
          Loaded by the browser directly — the device viewing the Agenda must
          reach this host.
        </span>
        <button
          type="submit"
          disabled={!dirty || pending}
          className="ml-auto bg-ink hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[12px] uppercase tracking-wider px-3 py-1.5 transition-colors"
        >
          {pending ? 'Saving…' : 'Save'}
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
