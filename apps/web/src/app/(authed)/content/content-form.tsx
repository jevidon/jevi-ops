'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createContentAction, updateContentAction, deleteContentAction, type SaveResult } from './actions';
import type { ContentItem, ContentItemStatus, ContentItemType } from '@/lib/api';

interface DomainOption {
  id: string;
  name: string;
}

interface InitialValues {
  id?: string;
  title: string;
  domain_id: string;
  type: ContentItemType;
  status: ContentItemStatus;
  outline_md: string;
  video_url: string;
  published_at: string;        // YYYY-MM-DD for the date input
}

const STATUS_OPTIONS: Array<{ value: ContentItemStatus; label: string }> = [
  { value: 'idea', label: 'Idea' },
  { value: 'outline', label: 'Outline' },
  { value: 'filming', label: 'Filming' },
  { value: 'editing', label: 'Editing' },
  { value: 'published', label: 'Published' },
  { value: 'derivatives_pending', label: 'Derivatives pending' },
  { value: 'done', label: 'Done' },
];

const TYPE_OPTIONS: Array<{ value: ContentItemType; label: string }> = [
  { value: 'video', label: 'Video' },
  { value: 'article', label: 'Article' },
  { value: 'short_clip', label: 'Short clip' },
  { value: 'podcast_episode', label: 'Podcast' },
  { value: 'newsletter', label: 'Newsletter' },
];

export function ContentForm({
  initial,
  domains,
}: {
  initial: InitialValues;
  domains: DomainOption[];
}) {
  const isEdit = Boolean(initial.id);
  const action = isEdit ? updateContentAction : createContentAction;
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

        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <select
              name="type"
              defaultValue={initial.type}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
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
        </div>

        <Field label="Channel / domain">
          <select
            name="domain_id"
            defaultValue={initial.domain_id}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            <option value="">(none)</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Video URL">
          <input
            type="url"
            name="video_url"
            defaultValue={initial.video_url}
            placeholder="https://youtube.com/watch?v=..."
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[13px] text-ink"
          />
        </Field>

        <Field label="Published date">
          <input
            type="date"
            name="published_at"
            defaultValue={initial.published_at}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </Field>

        <Field label="Outline / notes (markdown)">
          <textarea
            name="outline_md"
            rows={8}
            defaultValue={initial.outline_md}
            placeholder="## Hook&#10;&#10;## Main point&#10;&#10;## CTA"
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-mono text-[12px] text-ink leading-relaxed resize-y"
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
        <DeleteRow id={initial.id} title={initial.title} />
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
      {pending ? 'Saving…' : isEdit ? 'Save' : 'Add'}
    </button>
  );
}

function DeleteRow({ id, title }: { id: string; title: string }) {
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
          Delete content item…
        </button>
      ) : (
        <form action={deleteContentAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={id} />
          <span className="font-sans text-[13px] text-ink-2">
            Delete &ldquo;{title}&rdquo; permanently?
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
