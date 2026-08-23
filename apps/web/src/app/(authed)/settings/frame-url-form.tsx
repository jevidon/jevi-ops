'use client';

import { useActionState, useState } from 'react';
import { updateFrameUrlAction } from './actions';
import type { SyncResult } from './actions';

// Frame panel image URL (migration 0045) + Weather data-bundle URL
// (migration 0046). The image is loaded by the BROWSER (device must reach
// the host); the data bundle is fetched by the SERVER (~5 min revalidate)
// and rendered natively by the Weather panel. Blank hides each panel.

export function FrameUrlForm({
  current,
  currentData,
}: {
  current: string | null;
  currentData: string | null;
}) {
  const [state, formAction, pending] = useActionState<SyncResult | null, FormData>(
    async (_prev, formData) => updateFrameUrlAction(formData),
    null,
  );
  const [value, setValue] = useState(current ?? '');
  const [dataValue, setDataValue] = useState(currentData ?? '');
  const dirty =
    value.trim() !== (current ?? '') || dataValue.trim() !== (currentData ?? '');

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
      <label className="flex flex-col gap-1">
        <span className="eyebrow">Weather data URL</span>
        <input
          type="text"
          name="agenda_data_url"
          value={dataValue}
          onChange={(e) => setDataValue(e.target.value)}
          placeholder="http://100.101.65.121/api/current_data — blank hides the Weather panel"
          spellCheck={false}
          autoComplete="off"
          className="w-full max-w-xl bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-mono text-[13px] text-ink placeholder:text-ink-3"
        />
      </label>
      <div className="flex items-center gap-3">
        <span className="font-sans text-[12px] text-ink-3">
          The image is loaded by your browser (device must reach the host);
          the data bundle is fetched by the server and rendered natively.
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
