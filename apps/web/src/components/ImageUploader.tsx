'use client';

import { useRef, useState, useTransition } from 'react';
import type { Attachment } from '@/lib/api';
import { uploadImageAction } from '@/lib/upload-actions';
import { AttachmentGrid } from './AttachmentGrid';

// Eager upload, deferred attach.
//
// User picks one or more files → each gets uploaded immediately to
// Bunny via the upload server action → the resulting Attachment record
// gets appended to local state and rendered in the grid. The parent
// form reads the current attachments list (via onChange) and sends it
// with the rest of its fields on save.
//
// Why eager:
//   - Immediate feedback (you see the photo, then keep typing)
//   - Multi-file pick all upload in parallel
//   - The form save round-trip stays small (no payload of bytes)
//
// Trade-off: if you upload an image then close the page without saving,
// the file lives on Bunny but no DB row points to it. Accepted for v1
// — a periodic orphan-sweep cron can clean these up later.

export function ImageUploader({
  attachments,
  onChange,
  prefix,
  label = 'Add image',
  titleHint,
}: {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  prefix: 'notes' | 'journal' | 'other';
  label?: string;
  // Free text used to build the stored filename (YYYYMMDD-<slug>-xxxx.jpg).
  // Pass the current note title, or for journal entries the first few
  // words of the body. We read it via a callback so the most-recent
  // form value gets captured at upload time, not whatever was there
  // when the component first mounted.
  titleHint?: () => string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    // Kick off all uploads in parallel; report the first error if any
    // fail but commit whatever succeeded.
    // Capture the title hint NOW so every parallel upload uses the same
    // value (reading per-file would race against further keystrokes).
    const hint = (titleHint?.() ?? '').trim();
    startTransition(async () => {
      const results = await Promise.all(
        Array.from(files).map(async (file) => {
          const fd = new FormData();
          fd.append('file', file, file.name);
          // Carry the prefix as a form field so the server action can
          // be a single-arg `(FormData) => ...` — avoids brittle
          // multi-arg server-action encoding edge cases.
          fd.append('prefix', prefix);
          if (hint) fd.append('title_hint', hint);
          return uploadImageAction(fd);
        }),
      );
      const next = [...attachments];
      let firstErr: string | null = null;
      for (const r of results) {
        if (r.ok) next.push(r.attachment);
        else if (!firstErr) firstErr = r.error;
      }
      onChange(next);
      if (firstErr) setError(firstErr);
      // Reset the input so picking the same file again re-fires onChange.
      if (inputRef.current) inputRef.current.value = '';
    });
  }

  function removeAttachment(storage_path: string) {
    // Local-only removal. The Bunny file isn't actually deleted yet —
    // it gets unlinked when the parent form saves with the new array.
    // (See note on orphan-sweep above; same trade-off applies.)
    onChange(attachments.filter((a) => a.storage_path !== storage_path));
  }

  return (
    <div className="flex flex-col gap-3">
      <AttachmentGrid attachments={attachments} onRemove={removeAttachment} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="px-3 py-1.5 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? 'Uploading…' : `+ ${label}`}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {attachments.length > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {attachments.length} attached
          </span>
        )}
      </div>

      {error && (
        <div className="font-mono text-[10px] uppercase tracking-wider text-accent">
          {error}
        </div>
      )}
    </div>
  );
}
