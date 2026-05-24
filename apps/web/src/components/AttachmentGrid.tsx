'use client';

import type { Attachment } from '@/lib/api';

// Renders a grid of attachment thumbnails with optional captions
// below each. Click a thumbnail to open the full-size image in a new
// tab. Hover reveals an × to remove — the parent decides what
// "remove" means (typically: filter from the attachments array, then
// save the parent row).
//
// The caption under each tile is the reverse-geocoded address from
// EXIF GPS data, when present. Tap-and-hold (or hover) reveals the
// raw coordinates as a tooltip and offers a map link.
//
// Read-only mode (no onRemove) is used on detail views where we
// surface the images without an edit affordance.

export function AttachmentGrid({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove?: (storage_path: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {attachments.map((a) => (
        <li key={a.storage_path} className="flex flex-col gap-1">
          <div className="relative group aspect-square overflow-hidden border border-line bg-surface">
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.alt ?? a.location ?? ''}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </a>
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onRemove(a.storage_path);
                }}
                aria-label="Remove attachment"
                className="absolute top-1 right-1 h-6 w-6 flex items-center justify-center bg-bg/90 border border-line text-ink-3 hover:text-accent font-mono text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            )}
          </div>
          {a.location && (
            <a
              // Link to a generic geo: URL when coords are present so
              // tapping on mobile opens Maps; fall back to Google Maps
              // with a search query when only address is available.
              href={
                a.gps
                  ? `https://www.google.com/maps/search/?api=1&query=${a.gps.lat},${a.gps.lon}`
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.location)}`
              }
              target="_blank"
              rel="noopener noreferrer"
              title={a.gps ? `${a.gps.lat.toFixed(5)}, ${a.gps.lon.toFixed(5)}` : undefined}
              className="block font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors leading-tight line-clamp-2"
            >
              📍 {a.location}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
