'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createContentAction, updateContentAction, deleteContentAction, type SaveResult } from './actions';
import type { ContentItem, ContentItemStatus, ContentItemType, ContentPlatform } from '@/lib/api';
import { CONTENT_PLATFORMS, CONTENT_PLATFORM_LABELS } from '@jerad-ops/shared';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';
import { DateInput } from '@/components/DateInput';
import { RichComposer } from '@/components/RichComposer';

interface DomainOption {
  id: string;
  name: string;
}

export interface ContentInitialValues {
  id?: string;
  title: string;
  domain_id: string;
  type: ContentItemType;
  status: ContentItemStatus;
  outline_md: string;
  video_url: string;
  article_url: string;
  canonical_url: string;
  body_rich: string;
  published_at: string;        // YYYY-MM-DD
  produced_on: string;         // YYYY-MM-DD
  target_publish_date: string; // YYYY-MM-DD
  platforms: ContentPlatform[];
  meta: Record<string, unknown>;
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
  { value: 'course', label: 'Course' },
  { value: 'article', label: 'Article' },
  { value: 'short_clip', label: 'Short clip' },
  { value: 'podcast_episode', label: 'Podcast' },
  { value: 'newsletter', label: 'Newsletter' },
];

type MetaField = { key: string; label: string; kind: 'text' | 'number' | 'select'; options?: string[] };

interface FieldConfig {
  producedLabel: string;
  videoUrl: boolean;
  articleUrl: boolean;          // legacy companion link
  canonicalUrl: false | string; // false or the label
  targetDate: boolean;
  platforms: boolean;
  outline: boolean;
  body: false | string;         // false or the label
  meta: MetaField[];
}

// Per-type field sets (Addendum 07 §4). produced_on is one column; only the
// label changes per type.
const TYPE_FIELDS: Record<ContentItemType, FieldConfig> = {
  video: { producedLabel: 'Filmed on', videoUrl: true, articleUrl: true, canonicalUrl: false, targetDate: true, platforms: false, outline: true, body: 'YouTube description', meta: [] },
  // A course is one container, not an episode (Addendum 10 §7). Episode/module
  // number fields removed; produced_on relabels to "Started"; the canonical URL
  // is the course home. The curriculum lives in the checklist, not in fields.
  course: { producedLabel: 'Started', videoUrl: true, articleUrl: false, canonicalUrl: 'Course home URL', targetDate: true, platforms: false, outline: true, body: false, meta: [
    { key: 'companion_post_url', label: 'Companion post URL', kind: 'text' },
  ] },
  article: { producedLabel: 'Written on', videoUrl: false, articleUrl: false, canonicalUrl: 'Canonical URL', targetDate: true, platforms: false, outline: false, body: false, meta: [] },
  short_clip: { producedLabel: 'Produced on', videoUrl: false, articleUrl: false, canonicalUrl: false, targetDate: false, platforms: true, outline: false, body: false, meta: [] },
  podcast_episode: { producedLabel: 'Recorded on', videoUrl: false, articleUrl: false, canonicalUrl: 'Episode URL', targetDate: false, platforms: false, outline: true, body: 'Show notes', meta: [
    { key: 'guest_name', label: 'Guest name', kind: 'text' },
  ] },
  newsletter: { producedLabel: 'Written on', videoUrl: false, articleUrl: false, canonicalUrl: 'Post URL', targetDate: false, platforms: false, outline: false, body: 'Body', meta: [
    { key: 'platform', label: 'Platform', kind: 'select', options: ['substack', 'email'] },
  ] },
};

export function ContentForm({
  initial,
  domains,
}: {
  initial: ContentInitialValues;
  domains: DomainOption[];
}) {
  const isEdit = Boolean(initial.id);
  const action = isEdit ? updateContentAction : createContentAction;
  const [state, formAction] = useActionState<SaveResult | null, FormData>(action, null);
  const display = useTransientSaveResult(state);
  const [type, setType] = useState<ContentItemType>(initial.type);
  const cfg = TYPE_FIELDS[type];

  return (
    <>
      <form action={formAction} className="flex flex-col gap-5">
        {initial.id && <input type="hidden" name="id" value={initial.id} />}

        <Field label="Title (required)">
          <input
            type="text" name="title" required defaultValue={initial.title} autoComplete="off"
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[15px] text-ink"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <select
              name="type" value={type} onChange={(e) => setType(e.target.value as ContentItemType)}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            >
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select
              name="status" defaultValue={initial.status}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Channel / domain">
          <select
            name="domain_id" defaultValue={initial.domain_id}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            <option value="">(none)</option>
            {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>

        {cfg.videoUrl && (
          <Field label="Video URL">
            <input type="url" name="video_url" defaultValue={initial.video_url} placeholder="https://youtube.com/watch?v=..."
              className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[13px] text-ink" />
          </Field>
        )}

        {cfg.articleUrl && (
          <Field label="Companion link (blog post / Substack / etc.)">
            <input type="url" name="article_url" defaultValue={initial.article_url} placeholder="https://..."
              className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[13px] text-ink" />
          </Field>
        )}

        {cfg.canonicalUrl !== false && (
          <Field label={cfg.canonicalUrl}>
            <input type="url" name="canonical_url" defaultValue={initial.canonical_url} placeholder="https://..."
              className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[13px] text-ink" />
          </Field>
        )}

        {cfg.meta.length > 0 && (
          <>
            <input type="hidden" name="_has_meta" value="1" />
            <div className="grid grid-cols-2 gap-4">
              {cfg.meta.map((m) => (
                <Field key={m.key} label={m.label}>
                  {m.kind === 'select' ? (
                    <select name={`meta_${m.key}`} defaultValue={String(initial.meta[m.key] ?? '')}
                      className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink">
                      <option value="">(none)</option>
                      {m.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={m.kind === 'number' ? 'number' : 'text'} name={`meta_${m.key}`}
                      defaultValue={String(initial.meta[m.key] ?? '')}
                      className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[13px] text-ink" />
                  )}
                </Field>
              ))}
            </div>
          </>
        )}

        {cfg.platforms && (
          <Field label="Platforms">
            <input type="hidden" name="_has_platforms" value="1" />
            <div className="flex flex-wrap gap-3 pt-1">
              {CONTENT_PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 font-sans text-[13px] text-ink-2 cursor-pointer">
                  <input type="checkbox" name="platforms" value={p} defaultChecked={initial.platforms.includes(p)} className="accent-accent" />
                  {CONTENT_PLATFORM_LABELS[p]}
                </label>
              ))}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label={cfg.producedLabel}>
            <DateInput name="produced_on" defaultValue={initial.produced_on}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink" />
          </Field>
          {cfg.targetDate && (
            <Field label="Target publish date">
              <DateInput name="target_publish_date" defaultValue={initial.target_publish_date}
                className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink" />
            </Field>
          )}
          <Field label="Published date">
            <DateInput name="published_at" defaultValue={initial.published_at}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink" />
          </Field>
        </div>

        {cfg.outline && (
          <Field label="Outline / notes (markdown)">
            <textarea name="outline_md" rows={6} defaultValue={initial.outline_md}
              placeholder="## Hook&#10;&#10;## Main point&#10;&#10;## CTA"
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-mono text-[12px] text-ink leading-relaxed resize-y" />
          </Field>
        )}

        {cfg.body !== false && (
          // key by type so the composer re-seeds when switching types.
          <Field label={cfg.body}>
            <RichComposer key={type} name="body_rich" initialHtml={initial.body_rich} placeholder="Paste formatted content…" />
          </Field>
        )}

        {display && (
          <div className={`font-mono text-[11px] uppercase tracking-wider ${display.ok ? 'text-ink-2' : 'text-accent'}`}>
            {display.ok ? 'Saved.' : display.error}
          </div>
        )}

        <div className="pt-2"><SaveButton isEdit={isEdit} /></div>
      </form>

      {isEdit && initial.id && <DeleteRow id={initial.id} title={initial.title} />}
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
    <button type="submit" disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2.5 transition-colors">
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
        <button type="button" onClick={() => setConfirming(true)}
          className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
          Delete content item…
        </button>
      ) : (
        <form action={deleteContentAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={id} />
          <span className="font-sans text-[13px] text-ink-2">Delete &ldquo;{title}&rdquo; permanently?</span>
          <button type="submit" className="bg-accent text-bg font-sans font-semibold text-[12px] uppercase tracking-wider px-3 py-1.5 transition-colors">
            Confirm delete
          </button>
          <button type="button" onClick={() => setConfirming(false)}
            className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors">
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
