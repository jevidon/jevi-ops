'use client';

import { useState, useTransition } from 'react';
import type { Attachment } from '@/lib/api';
import { ImmichBrowser } from '../immich-browser';
import { attachImmichAction } from './actions';

// "Photos from this day" — the edit drawer's attach flow on top of the
// shared ImmichBrowser. Selected assets are linked (not copied) into the
// entry's attachments (the parent form state is replaced with the
// post-attach list so a later manual save can't clobber them).
//
// entryDate is the *committed* date field value (live from the edit form),
// savedDate the last persisted entry_date. When they differ, attaching also
// persists the new date ("attach saves date") and reports it via onAttached.
// Browsing another day in the strip never rewrites the entry date — that's
// intentional cross-date attachment.

export function ImmichStrip({
  entryId,
  entryDate,
  savedDate,
  attachments,
  onAttached,
}: {
  entryId: string;
  entryDate: string;
  savedDate: string;
  attachments: Attachment[];
  onAttached: (all: Attachment[], persistedDate: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const attachedIds = attachments
    .map((a) => a.immich_asset_id)
    .filter((x): x is string => Boolean(x));

  const attach = () =>
    startTransition(async () => {
      const ids = selectedIds;
      // Committed-vs-saved only — the browse date never rewrites the entry date.
      const persistDate = entryDate !== savedDate ? entryDate : undefined;
      const res = await attachImmichAction(entryId, ids, persistDate);
      if (res.ok) {
        // Growing attachments feeds attachedIds below; the browser
        // auto-deselects everything that landed (failed ids stay selected).
        onAttached(res.attachments, res.entry_date ?? savedDate);
        const parts: string[] = [];
        const attachedCount = ids.length - res.failed.length - res.already_attached.length;
        if (attachedCount > 0) parts.push(`attached ${attachedCount}`);
        if (res.already_attached.length > 0) parts.push(`${res.already_attached.length} already attached`);
        if (res.failed.length > 0) parts.push(`${res.failed.length} failed`);
        setMessage(parts.join(' · ') || 'Nothing to attach.');
      } else {
        setMessage(`Attach failed: ${res.error ?? 'unknown'}`);
      }
    });

  return (
    <div className="flex flex-col gap-2">
      <ImmichBrowser
        entryDate={entryDate}
        attachedIds={attachedIds}
        onSelectionChange={setSelectedIds}
        footer={
          <button
            type="button"
            onClick={attach}
            disabled={pending || selectedIds.length === 0}
            className="px-3 py-1.5 bg-ink text-bg font-mono text-[10px] uppercase tracking-wider hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Attaching…' : `Attach ${selectedIds.length || ''} selected`}
          </button>
        }
      />
      {message && (
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{message}</div>
      )}
    </div>
  );
}
