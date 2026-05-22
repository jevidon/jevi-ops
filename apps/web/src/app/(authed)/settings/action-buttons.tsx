'use client';

import { useState, useTransition } from 'react';
import { syncCalendarAction, disconnectGoogleAction, type SyncResult } from './actions';

export function ActionButtons() {
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  const sync = () =>
    startTransition(async () => {
      setLastResult(await syncCalendarAction());
    });

  const disconnect = () =>
    startTransition(async () => {
      if (!confirm('Disconnect Google Calendar? Existing synced events stay; new events will not sync.')) return;
      setLastResult(await disconnectGoogleAction());
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={sync}
          disabled={pending}
          className="bg-ink hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2.5 transition-colors"
        >
          {pending ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={pending}
          className="border border-line hover:border-ink-2 disabled:opacity-50 disabled:cursor-not-allowed font-sans text-[13px] uppercase tracking-wider px-4 py-2.5 transition-colors"
        >
          Disconnect
        </button>
      </div>
      {lastResult && (
        <div
          className={`font-mono text-[11px] uppercase tracking-wider ${
            lastResult.ok ? 'text-ink-2' : 'text-accent'
          }`}
        >
          {lastResult.message}
        </div>
      )}
    </div>
  );
}
