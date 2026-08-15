'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Attachment } from '@/lib/api';
import { useAppTimezone } from './TimezoneProvider';

// The library reading family's photo treatment (Detail Pages v2, Addendum 10
// §10): large, composed layouts — a single hero, a 2-up, or a hero + grid for
// 3+ — never the old thumbnail strip. Tap/click any image to open a full-view
// lightbox with keyboard paging. Journal sets this; Note inherits it. Non-image
// attachments are ignored; a missing content_type is treated as an image
// (mirrors lib-data's pickImages).

function isImage(a: Attachment): boolean {
  return Boolean(a.url) && (!a.content_type || a.content_type.startsWith('image'));
}

function fmtTakenAt(iso: string, tz: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export function PhotoGallery({ attachments }: { attachments: Attachment[] }) {
  const tz = useAppTimezone();
  const images = attachments.filter(isImage);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const n = images.length;

  const close = useCallback(() => setOpenIdx(null), []);
  const step = useCallback((d: number) => {
    setOpenIdx((i) => (i == null ? i : (i + d + n) % n));
  }, [n]);

  useEffect(() => {
    if (openIdx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [openIdx, close, step]);

  if (n === 0) return null;

  const hero = images[0]!; // n >= 1 guaranteed by the guard above
  const rest = images.slice(1);
  const active = openIdx != null ? images[openIdx] : undefined;

  return (
    <>
      {n === 1 ? (
        <Tile a={hero} onOpen={() => setOpenIdx(0)} className="aspect-[3/2]" priority />
      ) : n === 2 ? (
        <div className="grid grid-cols-2 gap-2">
          {images.map((a, i) => <Tile key={a.storage_path} a={a} onOpen={() => setOpenIdx(i)} className="aspect-[4/5]" />)}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Tile a={hero} onOpen={() => setOpenIdx(0)} className="aspect-[3/2]" priority />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {rest.map((a, i) => <Tile key={a.storage_path} a={a} onOpen={() => setOpenIdx(i + 1)} className="aspect-square" />)}
          </div>
        </div>
      )}

      {openIdx != null && active && (
        <div
          className="fixed inset-0 z-[60] bg-ink/92 flex flex-col select-none"
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={close}
        >
          <div className="flex items-center justify-between px-4 py-3 shrink-0 font-mono text-[11px] uppercase tracking-wider text-bg/70">
            <span className="tabular-nums">{openIdx + 1} / {n}</span>
            <button type="button" onClick={close} aria-label="Close" className="hover:text-bg transition-colors">✕ Close</button>
          </div>

          {/* No stopPropagation here — clicking the letterbox dark space should
              close (bubbles to the scrim). Only the controls below stop it. */}
          <div className="flex-1 flex items-center justify-center min-h-0 px-4 pb-2">
            {n > 1 && (
              <button type="button" onClick={(e) => { e.stopPropagation(); step(-1); }} aria-label="Previous"
                className="shrink-0 px-2 sm:px-4 py-8 text-bg/50 hover:text-bg text-2xl transition-colors">‹</button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.url} alt={active.alt ?? active.location ?? ''} onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full object-contain" />
            {n > 1 && (
              <button type="button" onClick={(e) => { e.stopPropagation(); step(1); }} aria-label="Next"
                className="shrink-0 px-2 sm:px-4 py-8 text-bg/50 hover:text-bg text-2xl transition-colors">›</button>
            )}
          </div>

          {(active.location || active.taken_at) && (
            <div
              className="shrink-0 px-4 pb-4 pt-1 text-center flex items-center justify-center gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              {active.taken_at && fmtTakenAt(active.taken_at, tz) && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-bg/60">
                  Taken {fmtTakenAt(active.taken_at, tz)}
                </span>
              )}
              {active.location && (
                <a
                  href={active.gps
                    ? `https://www.google.com/maps/search/?api=1&query=${active.gps.lat},${active.gps.lon}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(active.location)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="font-mono text-[10px] uppercase tracking-wider text-bg/60 hover:text-bg transition-colors"
                >
                  📍 {active.location}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Tile({ a, onOpen, className, priority }: { a: Attachment; onOpen: () => void; className: string; priority?: boolean }) {
  return (
    <figure className="flex flex-col gap-1 min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className={`group relative block w-full overflow-hidden rounded-sm border border-line bg-surface-2 ${className}`}
        aria-label="Open photo"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={a.url}
          alt={a.alt ?? a.location ?? ''}
          loading={priority ? 'eager' : 'lazy'}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      </button>
      {a.location && (
        <figcaption className="font-mono text-[10px] uppercase tracking-wider text-ink-3 leading-tight line-clamp-1">
          📍 {a.location}
        </figcaption>
      )}
    </figure>
  );
}
