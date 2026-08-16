'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ImmichCandidate } from '@/lib/api';
import { useAppTimezone } from '@/components/TimezoneProvider';
import { attachImmichAction, loadImmichCandidatesAction } from './actions';

// "From Immich · <date>" — the hybrid section on the journal reader. Shows
// what else exists in Immich from the entry's day, with one-click promote
// that links the asset into the entry's attachments. Lazy and
// quiet by design: renders nothing while loading, on any failure, when
// Immich isn't configured, or when everything from the day is already
// attached — the calm reader stays pristine and a slow Immich never blocks
// the server render. Day browsing lives in the edit drawer, not here.

function fmtShortDay(date: string, tz: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: tz, month: 'short', day: 'numeric',
  });
}

function fmtTime(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function FromImmichSection({
  entryId,
  entryDate,
  attachedAssetIds,
}: {
  entryId: string;
  entryDate: string;
  attachedAssetIds: string[];
}) {
  const tz = useAppTimezone();
  const router = useRouter();
  const [candidates, setCandidates] = useState<ImmichCandidate[] | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    loadImmichCandidatesAction(entryDate).then((res) => {
      if (cancelled) return;
      setCandidates(res.ok && res.configured ? res.candidates : []);
    });
    return () => {
      cancelled = true;
    };
  }, [entryDate]);

  const attached = new Set(attachedAssetIds);
  const remaining = (candidates ?? []).filter((c) => !attached.has(c.id));
  if (remaining.length === 0) return null;

  const promote = (assetId: string) => {
    setPromoting(assetId);
    setError(null);
    startTransition(async () => {
      // Never sends a date — read-page promote must not touch entry_date.
      const res = await attachImmichAction(entryId, [assetId]);
      if (res.ok && res.failed.length === 0) {
        // revalidatePath ran in the action; refresh pulls the new
        // attachments into PhotoGallery and grows attachedAssetIds, which
        // filters this candidate out of the row.
        router.refresh();
      } else {
        setError(res.error ?? 'attach failed');
      }
      setPromoting(null);
    });
  };

  return (
    <section className="mt-8">
      <div className="eyebrow mb-2">From Immich · {fmtShortDay(entryDate, tz)}</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {remaining.map((c) => {
          const isPromoting = promoting === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => promote(c.id)}
              disabled={promoting !== null}
              className={`group relative shrink-0 border border-line hover:border-ink-3 transition-colors ${
                isPromoting ? 'opacity-50' : ''
              }`}
              title={`Attach to this entry (${c.taken_at})`}
            >
              {/* Proxied through the web app so the session cookie authenticates. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.thumb_url}
                alt=""
                loading="lazy"
                className="h-24 w-24 object-cover"
              />
              <span className="absolute bottom-0 inset-x-0 bg-ink/60 text-bg font-mono text-[9px] px-1 text-left">
                {isPromoting ? 'attaching…' : fmtTime(c.taken_at, tz)}
              </span>
              <span className="absolute top-0.5 right-0.5 bg-ink/60 text-bg font-mono text-[10px] px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                + attach
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-accent">
          Immich: {error}
        </div>
      )}
    </section>
  );
}
