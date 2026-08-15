'use client';

import { useEffect, useState, useTransition } from 'react';
import type { Attachment, ImmichCandidate } from '@/lib/api';
import { useAppTimezone } from '@/components/TimezoneProvider';
import { attachImmichAction, loadImmichCandidatesAction } from './actions';

// "Photos from this day" — lazy candidate strip under the journal editor.
// Selected assets are copied server-side into local storage and appended to
// the entry's attachments (the parent form state is replaced with the
// post-attach list so a later manual save can't clobber them).
//
// entryDate is the *committed* date field value (live from the edit form),
// savedDate the last persisted entry_date. When they differ, attaching also
// persists the new date ("attach saves date") and reports it via onAttached.
// A separate browseDate lets ← → peek at adjacent days without touching the
// date field; attaching from a browse day is intentional cross-date
// attachment and never rewrites entry_date.
//
// Renders nothing when Immich isn't configured — the section only exists
// once Settings → AI → Immich is filled in.

// Anchor at noon UTC and format in UTC so a YYYY-MM-DD never rolls a day.
function fmtShortDay(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
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
  const tz = useAppTimezone();
  const [browseDate, setBrowseDate] = useState(entryDate);
  const [candidates, setCandidates] = useState<ImmichCandidate[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A new committed entry date snaps browsing back to it.
  useEffect(() => {
    setBrowseDate(entryDate);
  }, [entryDate]);

  useEffect(() => {
    let cancelled = false;
    setCandidates(null);
    setSelected(new Set());
    loadImmichCandidatesAction(browseDate).then((res) => {
      if (cancelled) return;
      setConfigured(res.configured);
      setCandidates(res.candidates);
      if (!res.ok && res.error) setMessage(`Immich: ${res.error}`);
    });
    return () => {
      cancelled = true;
    };
  }, [browseDate]);

  if (!configured) return null;

  const browsing = browseDate !== entryDate;
  const attachedIds = new Set(
    attachments.map((a) => a.immich_asset_id).filter((x): x is string => Boolean(x)),
  );

  const stepDay = (delta: number) => {
    const dt = new Date(`${browseDate}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + delta);
    setBrowseDate(dt.toISOString().slice(0, 10));
  };

  const toggle = (id: string) => {
    if (attachedIds.has(id)) return;
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
      // Committed-vs-saved only — browseDate never rewrites the entry date.
      const persistDate = entryDate !== savedDate ? entryDate : undefined;
      const res = await attachImmichAction(entryId, ids, persistDate);
      if (res.ok) {
        onAttached(res.attachments, res.entry_date ?? savedDate);
        setSelected(new Set());
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
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <button
          type="button"
          onClick={() => stepDay(-1)}
          className="px-1 hover:text-ink-2 transition-colors"
          aria-label="Browse previous day"
        >
          ‹
        </button>
        <span className={browsing ? 'text-accent' : ''}>
          {fmtShortDay(browseDate)}
          {browsing ? ' · browsing' : ''}
        </span>
        <button
          type="button"
          onClick={() => stepDay(1)}
          className="px-1 hover:text-ink-2 transition-colors"
          aria-label="Browse next day"
        >
          ›
        </button>
        {browsing && (
          <button
            type="button"
            onClick={() => setBrowseDate(entryDate)}
            className="ml-1 hover:text-ink-2 transition-colors"
          >
            ↩ back to entry date
          </button>
        )}
      </div>

      {candidates === null ? (
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Checking Immich…</div>
      ) : candidates.length === 0 ? (
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          No Immich photos from {fmtShortDay(browseDate)}.
          {message ? ` · ${message}` : ''}
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {candidates.map((c) => {
              const isAttached = attachedIds.has(c.id);
              const isSelected = selected.has(c.id);
              const time = fmtTime(c.taken_at, tz);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  disabled={isAttached}
                  className={`relative shrink-0 border-2 transition-colors ${
                    isAttached
                      ? 'border-line opacity-50 cursor-default'
                      : isSelected
                        ? 'border-accent'
                        : 'border-line hover:border-ink-3'
                  }`}
                  title={c.taken_at}
                >
                  {/* Proxied through the web app so the session cookie authenticates. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.thumb_url}
                    alt=""
                    loading="lazy"
                    className="h-20 w-20 object-cover"
                  />
                  <span className="absolute bottom-0 inset-x-0 bg-ink/60 text-bg font-mono text-[9px] px-1 text-left">
                    {browsing ? `${fmtShortDay(browseDate)} ` : ''}
                    {time}
                  </span>
                  {isAttached ? (
                    <span className="absolute top-0.5 right-0.5 bg-ink text-bg font-mono text-[9px] px-1">✓ attached</span>
                  ) : isSelected ? (
                    <span className="absolute top-0.5 right-0.5 bg-accent text-bg font-mono text-[10px] px-1">✓</span>
                  ) : null}
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
              {candidates.length} photo{candidates.length === 1 ? '' : 's'} from {browsing ? 'that day' : 'this day'}
              {attachments.length > 0 ? ` · ${attachments.length} attached` : ''}
              {candidates.length === 100 ? ' · showing first 100' : ''}
            </span>
          </div>
          {message && (
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{message}</div>
          )}
        </>
      )}
    </div>
  );
}
