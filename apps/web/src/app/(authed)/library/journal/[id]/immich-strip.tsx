'use client';

import { useEffect, useState, useTransition } from 'react';
import type { Attachment, ImmichCandidate } from '@/lib/api';
import { attachImmichAction, loadImmichCandidatesAction } from './actions';

// "Photos from this day" — lazy candidate strip under the journal editor.
// Selected assets are copied server-side into local storage and appended to
// the entry's attachments (the parent form state is replaced with the
// post-attach list so a later manual save can't clobber them).
//
// Renders nothing when Immich isn't configured — the section only exists
// once Settings → AI → Immich is filled in.

export function ImmichStrip({
  entryId,
  entryDate,
  attachments,
  onAttached,
}: {
  entryId: string;
  entryDate: string;
  attachments: Attachment[];
  onAttached: (all: Attachment[]) => void;
}) {
  const [candidates, setCandidates] = useState<ImmichCandidate[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setCandidates(null);
    setSelected(new Set());
    loadImmichCandidatesAction(entryDate).then((res) => {
      if (cancelled) return;
      setConfigured(res.configured);
      setCandidates(res.candidates);
      if (!res.ok && res.error) setMessage(`Immich: ${res.error}`);
    });
    return () => {
      cancelled = true;
    };
  }, [entryDate]);

  if (!configured) return null;
  if (candidates === null) {
    return <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Checking Immich…</div>;
  }
  if (candidates.length === 0) {
    return (
      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
        No Immich photos from {entryDate}.
        {message ? ` · ${message}` : ''}
      </div>
    );
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const attach = () =>
    startTransition(async () => {
      const ids = Array.from(selected);
      const res = await attachImmichAction(entryId, ids);
      if (res.ok) {
        onAttached(res.attachments);
        setSelected(new Set());
        setMessage(
          res.failed.length > 0
            ? `Attached ${ids.length - res.failed.length}, ${res.failed.length} failed.`
            : `Attached ${ids.length} photo${ids.length === 1 ? '' : 's'}.`,
        );
      } else {
        setMessage(`Attach failed: ${res.error ?? 'unknown'}`);
      }
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {candidates.map((c) => {
          const isSelected = selected.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={`relative shrink-0 border-2 transition-colors ${
                isSelected ? 'border-accent' : 'border-line hover:border-ink-3'
              }`}
              title={c.taken_at}
            >
              {/* Proxied through the web app so the session cookie authenticates. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/immich/thumb/${c.id}`}
                alt=""
                loading="lazy"
                className="h-20 w-20 object-cover"
              />
              {isSelected && (
                <span className="absolute top-0.5 right-0.5 bg-accent text-bg font-mono text-[10px] px-1">✓</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={attach}
          disabled={pending || selected.size === 0}
          className="px-3 py-1.5 bg-ink text-bg font-mono text-[10px] uppercase tracking-wider hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? 'Attaching…' : `Attach ${selected.size || ''} selected`}
        </button>
        <span className="font-mono text-[10px] text-ink-3">
          {candidates.length} photo{candidates.length === 1 ? '' : 's'} from this day
          {attachments.length > 0 ? ` · ${attachments.length} attached` : ''}
        </span>
      </div>
      {message && (
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{message}</div>
      )}
    </div>
  );
}
