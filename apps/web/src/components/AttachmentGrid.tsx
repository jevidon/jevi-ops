'use client';

import type { Attachment } from '@/lib/api';

// Renders a grid of attachment thumbnails. Click a thumbnail to open
// the full-size image in a new tab. Hover reveals an × to remove —
// the parent decides what "remove" means (typically: filter from the
// attachments array, then save the parent row).
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
        <li key={a.storage_path} className="relative group aspect-square overflow-hidden border border-line bg-surface">
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.url}
              alt={a.alt ?? ''}
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
        </li>
      ))}
    </ul>
  );
}
