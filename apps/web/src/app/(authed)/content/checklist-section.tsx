'use client';

import { useActionState, useEffect, useRef } from 'react';
import {
  addChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
  seedDefaultsAction,
  type SaveResult,
} from './actions';
import type { ContentChecklistItem } from '@/lib/api';

// Checkable checklist on /content/[id]. Each item flips done/undone via a
// tiny form (server action — no client-side state). Items dispatched as
// separate <form>s rather than one big controlled list because the JSX
// stays simpler and submissions stay scoped per item.

export function ChecklistSection({
  contentId,
  items,
}: {
  contentId: string;
  items: ContentChecklistItem[];
}) {
  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between mb-3">
        <div className="eyebrow">
          Checklist {items.length > 0 ? `· ${doneCount}/${items.length}` : ''}
        </div>
        {items.length === 0 && (
          <form action={seedDefaultsAction}>
            <input type="hidden" name="contentId" value={contentId} />
            <button
              type="submit"
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
            >
              + Add default items
            </button>
          </form>
        )}
      </div>

      {items.length === 0 ? (
        <div className="font-sans text-[13px] text-ink-3 italic mb-4">
          No checklist yet. Click &ldquo;Add default items&rdquo; to seed steps for this content type, or add your own below.
        </div>
      ) : (
        <ul className="mb-4 space-y-1">
          {items.map((item) => (
            <ChecklistRow key={item.id} contentId={contentId} item={item} />
          ))}
        </ul>
      )}

      <AddChecklistItemForm contentId={contentId} />
    </section>
  );
}

function ChecklistRow({
  contentId,
  item,
}: {
  contentId: string;
  item: ContentChecklistItem;
}) {
  return (
    <li className="flex items-center gap-3 py-1.5 group">
      <form action={toggleChecklistItemAction} className="shrink-0">
        <input type="hidden" name="contentId" value={contentId} />
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="done" value={item.done ? 'false' : 'true'} />
        <button
          type="submit"
          aria-label={item.done ? 'Mark not done' : 'Mark done'}
          className={`h-5 w-5 border-2 flex items-center justify-center transition-colors ${
            item.done ? 'bg-ink border-ink text-bg' : 'border-line hover:border-ink-2'
          }`}
        >
          {item.done && (
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </form>
      <span
        className={`flex-1 font-sans text-[14px] leading-snug ${
          item.done ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink'
        }`}
      >
        {item.title}
      </span>
      <form action={deleteChecklistItemAction} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <input type="hidden" name="contentId" value={contentId} />
        <input type="hidden" name="itemId" value={item.id} />
        <button
          type="submit"
          aria-label="Delete item"
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          ✕
        </button>
      </form>
    </li>
  );
}

function AddChecklistItemForm({ contentId }: { contentId: string }) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    addChecklistItemAction,
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      // Clear the input on successful add so you can chain entries.
      inputRef.current?.form?.reset();
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="contentId" value={contentId} />
      <span className="text-ink-3 text-[14px] select-none" aria-hidden>+</span>
      <input
        ref={inputRef}
        type="text"
        name="title"
        required
        placeholder="Add a checklist item…"
        autoComplete="off"
        disabled={pending}
        className="flex-1 bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[14px] placeholder:text-ink-3/70 text-ink"
      />
      {state && !state.ok && (
        <span className="font-mono text-[10px] uppercase text-accent">{state.error}</span>
      )}
    </form>
  );
}
