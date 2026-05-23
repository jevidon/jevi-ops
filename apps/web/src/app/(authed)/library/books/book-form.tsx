'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createBookAction, updateBookAction, deleteBookAction, type SaveResult } from './actions';
import type { Book } from '@/lib/api';

interface InitialValues {
  id?: string;                 // present → edit mode; absent → create mode
  title: string;
  author: string;
  isbn: string;
  cover_image_url: string;
  status: Book['status'];
  format: Book['format'] | '';
  started_at: string;
  finished_at: string;
  rating: number | '';
  my_summary: string;
}

const STATUS_OPTIONS: Array<{ value: Book['status']; label: string }> = [
  { value: 'want_to_read', label: 'Want to read' },
  { value: 'reading', label: 'Reading' },
  { value: 'finished', label: 'Finished' },
  { value: 'abandoned', label: 'Abandoned' },
];

const FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '(none)' },
  { value: 'physical', label: 'Physical' },
  { value: 'kindle', label: 'Kindle' },
  { value: 'audiobook', label: 'Audiobook' },
];

export function BookForm({ initial }: { initial: InitialValues }) {
  const isEdit = Boolean(initial.id);
  const action = isEdit ? updateBookAction : createBookAction;
  const [state, formAction] = useActionState<SaveResult | null, FormData>(action, null);

  return (
    <>
      <form action={formAction} className="flex flex-col gap-5">
        {initial.id && <input type="hidden" name="id" value={initial.id} />}

        <Field label="Title (required)">
          <input
            type="text"
            name="title"
            required
            defaultValue={initial.title}
            autoComplete="off"
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[15px] text-ink"
          />
        </Field>

        <Field label="Author">
          <input
            type="text"
            name="author"
            defaultValue={initial.author}
            autoComplete="off"
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
        </Field>

        <Field label="Cover image URL">
          <input
            type="url"
            name="cover_image_url"
            defaultValue={initial.cover_image_url}
            placeholder="https://images-na.ssl-images-amazon.com/..."
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[13px] text-ink"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Status">
            <select
              name="status"
              defaultValue={initial.status}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Format">
            <select
              name="format"
              defaultValue={initial.format ?? ''}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            >
              {FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Started">
            <input
              type="date"
              name="started_at"
              defaultValue={initial.started_at}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            />
          </Field>
          <Field label="Finished">
            <input
              type="date"
              name="finished_at"
              defaultValue={initial.finished_at}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            />
          </Field>
        </div>

        <Field label="Rating (1-5, blank for none)">
          <select
            name="rating"
            defaultValue={initial.rating === '' ? '' : String(initial.rating)}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            <option value="">(no rating)</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n} / 5</option>
            ))}
          </select>
        </Field>

        <Field label="ISBN">
          <input
            type="text"
            name="isbn"
            defaultValue={initial.isbn}
            placeholder="optional"
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[13px] text-ink"
          />
        </Field>

        <Field label="My summary / notes">
          <textarea
            name="my_summary"
            rows={4}
            defaultValue={initial.my_summary}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[13px] text-ink resize-y"
          />
        </Field>

        {state && (
          <div className={`font-mono text-[11px] uppercase tracking-wider ${state.ok ? 'text-ink-2' : 'text-accent'}`}>
            {state.ok ? 'Saved.' : state.error}
          </div>
        )}

        <div className="pt-2">
          <SaveButton isEdit={isEdit} />
        </div>
      </form>

      {isEdit && initial.id && (
        <DeleteRow bookId={initial.id} title={initial.title} />
      )}
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

function SaveButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2.5 transition-colors"
    >
      {pending ? 'Saving…' : isEdit ? 'Save' : 'Add book'}
    </button>
  );
}

function DeleteRow({ bookId, title }: { bookId: string; title: string }) {
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
          Delete book…
        </button>
      ) : (
        <form action={deleteBookAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={bookId} />
          <span className="font-sans text-[13px] text-ink-2">
            Delete &ldquo;{title}&rdquo;? Highlights stay (just unlinked).
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
