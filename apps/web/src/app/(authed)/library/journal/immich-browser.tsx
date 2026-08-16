'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ImmichCandidate } from '@/lib/api';
import { loadImmichCandidatesAction } from './[id]/actions';

// Shared Immich candidate browser — the day-strip of selectable thumbnails
// used by both the edit drawer (immich-strip.tsx, which attaches directly)
// and the new-entry form (which collects a selection to attach right after
// create). Owns the browse-date state (← → day stepping, snap-back when the
// committed entry date changes), candidate loading, and selection.
//
// Selection is reported upward via onSelectionChange. Candidates whose ids
// appear in attachedIds render badged + disabled, and anything selected that
// later shows up in attachedIds is auto-deselected (so a successful attach
// clears exactly the ids that landed, leaving failed ones selected for
// retry).
//
// Renders nothing when Immich isn't configured. `footer` renders below the
// thumbnails only when there are candidates to act on.

// Anchor at noon UTC and format in UTC so a YYYY-MM-DD never rolls a day.
function fmtShortDay(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

// taken_at is wall-clock time with a conventional Z suffix (Immich's
// localDateTime semantics) — format in UTC so the clock renders verbatim,
// exactly as Immich's own timeline shows it. Converting through the app
// timezone would shift an already-local time.
function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function ImmichBrowser({
  entryDate,
  attachedIds = [],
  onSelectionChange,
  footer,
}: {
  entryDate: string;
  attachedIds?: string[];
  onSelectionChange: (ids: string[]) => void;
  footer?: ReactNode;
}) {
  const [browseDate, setBrowseDate] = useState(entryDate);
  const [candidates, setCandidates] = useState<ImmichCandidate[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);

  // Latest callback without threading it through effect deps (parents pass
  // inline closures whose identity changes every render).
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const setSel = (next: Set<string>) => {
    setSelected(next);
    onSelectionChangeRef.current(Array.from(next));
  };

  // A new committed entry date snaps browsing back to it.
  useEffect(() => {
    setBrowseDate(entryDate);
  }, [entryDate]);

  useEffect(() => {
    let cancelled = false;
    setCandidates(null);
    setSelected(new Set());
    onSelectionChangeRef.current([]);
    loadImmichCandidatesAction(browseDate).then((res) => {
      if (cancelled) return;
      setConfigured(res.configured);
      setCandidates(res.candidates);
      setLoadError(!res.ok && res.error ? res.error : null);
    });
    return () => {
      cancelled = true;
    };
  }, [browseDate]);

  // Ids that became attached (e.g. a successful attach from the parent)
  // drop out of the selection automatically.
  const attachedKey = attachedIds.join('|');
  useEffect(() => {
    setSelected((prev) => {
      const attached = new Set(attachedKey ? attachedKey.split('|') : []);
      const next = new Set(Array.from(prev).filter((id) => !attached.has(id)));
      if (next.size === prev.size) return prev;
      onSelectionChangeRef.current(Array.from(next));
      return next;
    });
  }, [attachedKey]);

  if (!configured) return null;

  const browsing = browseDate !== entryDate;
  const attached = new Set(attachedIds);

  const stepDay = (delta: number) => {
    const dt = new Date(`${browseDate}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + delta);
    setBrowseDate(dt.toISOString().slice(0, 10));
  };

  const toggle = (id: string) => {
    if (attached.has(id)) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  };

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
          {loadError ? ` · Immich: ${loadError}` : ''}
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {candidates.map((c) => {
              const isAttached = attached.has(c.id);
              const isSelected = selected.has(c.id);
              const time = fmtTime(c.taken_at);
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
          <div className="flex items-center gap-3 flex-wrap">
            {footer}
            <span className="font-mono text-[10px] text-ink-3">
              {candidates.length} photo{candidates.length === 1 ? '' : 's'} from {browsing ? 'that day' : 'this day'}
              {attachedIds.length > 0 ? ` · ${attachedIds.length} attached` : ''}
              {candidates.length === 100 ? ' · showing first 100' : ''}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
