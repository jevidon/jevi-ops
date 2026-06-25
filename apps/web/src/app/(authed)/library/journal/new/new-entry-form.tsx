'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createJournalEntryAction, type SaveResult } from './actions';
import type { Attachment } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';
import { DateInput } from '@/components/DateInput';

// Manual journal entry compose. Voice / photo capture still go through
// cmd+J → parser → executor; this is the explicit path for typing.

export function NewJournalEntryForm({ today }: { today: string }) {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(
    createJournalEntryAction,
    null,
  );
  const { pending } = useFormStatus();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [text, setText] = useState('');

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-2xl">
      <label className="flex flex-col gap-1">
        <span className="eyebrow">Date</span>
        <DateInput
          name="entry_date"
          defaultValue={today}
          className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink w-48"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="eyebrow">Entry</span>
        <textarea
          name="transcription_text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          rows={10}
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
          titleHint={() => text.trim().slice(0, 120)}
        />
      </div>
      <input type="hidden" name="attachments" value={JSON.stringify(attachments)} />

      <div className="flex items-center gap-3 pt-2">
        <SubmitButton />
        {state?.ok === false && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
            {state.error}
          </span>
        )}
      </div>

      <p className="font-sans text-[12px] text-ink-3 mt-2">
        Tip: leave the text empty to log just an image (e.g. a photo of a paper page).
        {pending ? '' : ''}
      </p>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-ink text-bg font-mono text-[11px] uppercase tracking-wider hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? 'Saving…' : 'Save entry'}
    </button>
  );
}
