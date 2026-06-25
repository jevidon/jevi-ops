'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createNoteAction, type SaveResult } from './actions';
import type { Attachment, NoteSourceType } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';

// Mirrors the edit form (apps/web/src/app/(authed)/library/notes/[id]/
// edit-note-form.tsx) without the id + delete row. Server action
// redirects to the new note's detail page on success.

const SOURCE_TYPE_OPTIONS: Array<{ value: NoteSourceType; label: string }> = [
  { value: 'own_thought', label: 'Own thought' },
  { value: 'reading_response', label: 'Reading response' },
  { value: 'meeting_note', label: 'Meeting note' },
  { value: 'brainstorm', label: 'Brainstorm' },
  { value: 'observation', label: 'Observation' },
  { value: 'other', label: 'Other' },
];

export function NewNoteForm({
  defaultSourceType = 'own_thought',
}: {
  defaultSourceType?: NoteSourceType;
}) {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(
    createNoteAction,
    null,
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field label="Title (optional)">
        <input
          type="text"
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short headline."
          autoComplete="off"
          className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[15px] text-ink"
        />
      </Field>

      <Field label="Body (required)">
        <textarea
          name="body"
          required
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          autoFocus
          placeholder="What's on your mind?"
          className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink leading-relaxed resize-y"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Source type">
          <select
            name="source_type"
            defaultValue={defaultSourceType}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            {SOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Source reference">
          <input
            type="text"
            name="source_reference"
            placeholder="e.g. Mere Christianity, Substack article, Randy call"
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </Field>
      </div>

      <Field label="Tags (comma-separated)">
        <input
          type="text"
          name="tags"
          placeholder="leadership, stewardship"
          className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
        />
      </Field>

      <label className="flex items-center gap-2 font-sans text-[13px] text-ink-2 cursor-pointer">
        <input type="checkbox" name="needs_review" className="accent-accent" />
        Needs review
      </label>

      <Field label="Images">
        <ImageUploader
          attachments={attachments}
          onChange={setAttachments}
          prefix="notes"
          titleHint={() => (title.trim() || body.trim()).slice(0, 120)}
        />
      </Field>
      <input type="hidden" name="attachments" value={JSON.stringify(attachments)} />

      {state?.ok === false && (
        <div className="font-mono text-[11px] uppercase tracking-wider text-accent">
          {state.error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <SaveButton />
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow block mb-1">{label}</span>
      {children}
    </label>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2.5 transition-colors"
    >
      {pending ? 'Saving…' : 'Save note'}
    </button>
  );
}
