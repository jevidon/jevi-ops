'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createQuoteAction, updateQuoteAction, type SaveResult } from './actions';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';

interface BookOption {
  id: string;
  title: string;
  author: string | null;
}

interface InitialValues {
  id?: string;                 // present → edit mode
  text: string;
  book_id: string;             // '' = no book link
  source_type: string;         // '' = unset
  source_author: string;
  source_reference: string;
  page_number: string;         // input value is always string
  chapter: string;
  tags: string;                // comma-separated input
}

const SOURCE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '(none)' },
  { value: 'book', label: 'Book' },
  { value: 'article', label: 'Article' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'conversation', label: 'Conversation' },
  { value: 'sermon', label: 'Sermon' },
  { value: 'other', label: 'Other' },
];

export function QuoteForm({
  initial,
  books,
}: {
  initial: InitialValues;
  books: BookOption[];
}) {
  const isEdit = Boolean(initial.id);
  const action = isEdit ? updateQuoteAction : createQuoteAction;
  const [state, formAction] = useActionState<SaveResult | null, FormData>(action, null);
  const display = useTransientSaveResult(state);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <Field label="Highlight text (required)">
        <textarea
          name="text"
          required
          rows={5}
          defaultValue={initial.text}
          className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-serif text-[15px] text-ink leading-relaxed resize-y italic"
        />
      </Field>

      <Field label="Book">
        <select
          name="book_id"
          defaultValue={initial.book_id}
          className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
        >
          <option value="">(none — standalone quote)</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}{b.author ? ` — ${b.author}` : ''}
            </option>
          ))}
        </select>
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
        <Field label="Page / location">
          <input
            type="text"
            name="page_number"
            defaultValue={initial.page_number}
            placeholder="e.g. 47"
            inputMode="numeric"
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </Field>
      </div>

      <Field label="Author (overrides book author if set)">
        <input
          type="text"
          name="source_author"
          defaultValue={initial.source_author}
          className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] text-ink"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Chapter">
          <input
            type="text"
            name="chapter"
            defaultValue={initial.chapter}
            placeholder="optional"
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[13px] text-ink"
          />
        </Field>
        <Field label="Source URL / reference">
          <input
            type="text"
            name="source_reference"
            defaultValue={initial.source_reference}
            placeholder="optional"
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[13px] text-ink"
          />
        </Field>
      </div>

      <Field label="Tags (comma-separated)">
        <input
          type="text"
          name="tags"
          defaultValue={initial.tags}
          placeholder="e.g. favorite, leadership"
          className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[13px] text-ink"
        />
      </Field>

      {display && (
        <div className={`font-mono text-[11px] uppercase tracking-wider ${display.ok ? 'text-ink-2' : 'text-accent'}`}>
          {display.ok ? 'Saved.' : display.error}
        </div>
      )}

      <div className="pt-2">
        <SaveButton isEdit={isEdit} />
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

function SaveButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2.5 transition-colors"
    >
      {pending ? 'Saving…' : isEdit ? 'Save' : 'Add highlight'}
    </button>
  );
}
