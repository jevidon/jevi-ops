'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import {
  updateJournalEntryAction,
  deleteJournalEntryAction,
  type SaveResult,
} from './actions';
import type { Attachment } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';

export interface JournalFormInitial {
  id: string;
  entry_date: string;       // YYYY-MM-DD
  transcription_text: string;
  attachments: Attachment[];
}

export function JournalEditForm({ initial }: { initial: JournalFormInitial }) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    updateJournalEntryAction,
    null,
  );
  const display = useTransientSaveResult(state);
  const [attachments, setAttachments] = useState<Attachment[]>(initial.attachments);
  // Controlled transcription so the ImageUploader can pull the first
  // few words as the stored-filename hint at upload time.
  const [text, setText] = useState(initial.transcription_text);

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4 max-w-2xl">
        <input type="hidden" name="id" value={initial.id} />

        <label className="flex flex-col gap-1">
          <span className="eyebrow">Date</span>
          <input
            type="date"
            name="entry_date"
            defaultValue={initial.entry_date}
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink w-fit"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">Entry</span>
          <textarea
            name="transcription_text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="What's on your mind?"
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-3 font-sans text-[15px] text-ink leading-relaxed resize-y placeholder:text-ink-3/60"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="eyebrow">Images</span>
          <ImageUploader
            attachments={attachments}
            onChange={setAttachments}
            prefix="journal"
            // Journal entries don't have a title — feed the first 120
            // chars of the body to slugify into a filename. The
            // server's slugifier caps it at 4 words.
            titleHint={() => text.trim().slice(0, 120)}
          />
        </div>
        <input type="hidden" name="attachments" value={JSON.stringify(attachments)} />

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 bg-ink text-bg font-mono text-[11px] uppercase tracking-wider hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <Link
            href="/library/journal"
            className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
          >
            Back to list
          </Link>
          {display?.ok === false && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
              {display.error}
            </span>
          )}
          {display?.ok === true && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
              ✓ Saved
            </span>
          )}
        </div>
      </form>

      <div className="mt-10 pt-4 border-t border-line max-w-2xl">
        <div className="eyebrow mb-2 text-accent">Danger zone</div>
        <form
          action={deleteJournalEntryAction}
          onSubmit={(e) => {
            if (!confirm('Delete this journal entry permanently? Attached images stay on storage as orphans.')) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={initial.id} />
          <button
            type="submit"
            className="px-3 py-1.5 border border-accent text-accent font-mono text-[10px] uppercase tracking-wider hover:bg-accent hover:text-bg transition-colors"
          >
            Delete entry
          </button>
        </form>
      </div>
    </>
  );
}
