'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateNoteAction, deleteNoteAction, type SaveResult } from './actions';
import type { NoteSourceType } from '@/lib/api';

interface InitialValues {
  id: string;
  title: string;
  body: string;
  source_type: NoteSourceType;
  source_reference: string;
  tags: string[];
  needs_review: boolean;
}

const SOURCE_TYPE_OPTIONS: Array<{ value: NoteSourceType; label: string }> = [
  { value: 'own_thought', label: 'Own thought' },
  { value: 'reading_response', label: 'Reading response' },
  { value: 'meeting_note', label: 'Meeting note' },
  { value: 'brainstorm', label: 'Brainstorm' },
  { value: 'observation', label: 'Observation' },
  { value: 'other', label: 'Other' },
];

export function EditNoteForm({ initial }: { initial: InitialValues }) {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(
    updateNoteAction,
    null,
  );

  return (
    <>
      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="id" value={initial.id} />

        <Field label="Title (optional)">
          <input
            type="text"
            name="title"
            defaultValue={initial.title}
            placeholder="Short headline. Leave blank for voice captures."
            autoComplete="off"
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[15px] text-ink"
          />
        </Field>

        <Field label="Body">
          <textarea
            name="body"
            required
            rows={6}
            defaultValue={initial.body}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink leading-relaxed resize-y"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Source type">
            <select
              name="source_type"
              defaultValue={initial.source_type}
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
              defaultValue={initial.source_reference}
              placeholder="e.g. Mere Christianity, Substack article, Randy call"
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            />
          </Field>
        </div>

        <Field label="Tags (comma-separated)">
          <input
            type="text"
            name="tags"
            defaultValue={initial.tags.join(', ')}
            placeholder="leadership, stewardship"
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </Field>

        <label className="flex items-center gap-2 font-sans text-[13px] text-ink-2 cursor-pointer">
          <input
            type="checkbox"
            name="needs_review"
            defaultChecked={initial.needs_review}
            className="accent-accent"
          />
          Needs review
        </label>

        {state && (
          <div
            className={`font-mono text-[11px] uppercase tracking-wider ${
              state.ok ? 'text-ink-2' : 'text-accent'
            }`}
          >
            {state.ok ? 'Saved.' : state.error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <SaveButton />
        </div>
      </form>

      <DeleteRow noteId={initial.id} preview={initial.body.slice(0, 60)} />
    </>
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
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

function DeleteRow({ noteId, preview }: { noteId: string; preview: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-12 pt-6 border-t border-line">
      <div className="eyebrow mb-3">Danger zone</div>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          Delete note…
        </button>
      ) : (
        <form action={deleteNoteAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={noteId} />
          <span className="font-sans text-[13px] text-ink-2">
            Delete &ldquo;{preview}{preview.length === 60 ? '…' : ''}&rdquo; permanently?
          </span>
          <button
            type="submit"
            className="bg-accent text-bg font-sans font-semibold text-[12px] uppercase tracking-wider px-3 py-1.5 transition-colors"
          >
            Confirm delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
