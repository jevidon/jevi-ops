'use client';

import { useActionState, useEffect, useRef } from 'react';
import {
  addChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
  type SaveResult,
} from './checklist-actions';
import type { ProjectChecklistItem } from '@/lib/api';

// Project sub-step checklist. Same UX as the content checklist: each row
// is its own form (toggle, delete) so submissions stay scoped per item.
// Granularity-wise: use this for "ping client", "draft scope doc" —
// things below the bar for a full task row.

export function ChecklistSection({
  projectId,
  items,
}: {
  projectId: string;
  items: ProjectChecklistItem[];
}) {
  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className="px-5 lg:px-0 pt-6">
      <div className="flex items-baseline justify-between mb-3 border-b border-line pb-2">
        <div className="eyebrow">
          Checklist {items.length > 0 ? `· ${doneCount}/${items.length}` : ''}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="font-sans text-[13px] text-ink-3 italic mb-4">
          No checklist yet. Use this for granular sub-steps that don&rsquo;t
          warrant a full task or milestone.
        </div>
      ) : (
        <ul className="mb-4 space-y-1">
          {items.map((item) => (
            <ChecklistRow key={item.id} projectId={projectId} item={item} />
          ))}
        </ul>
      )}

      <AddChecklistItemForm projectId={projectId} />
    </section>
  );
}

function ChecklistRow({
  projectId,
  item,
}: {
  projectId: string;
  item: ProjectChecklistItem;
}) {
  return (
    <li className="flex items-center gap-3 py-1.5 group">
      <form action={toggleChecklistItemAction} className="shrink-0">
        <input type="hidden" name="projectId" value={projectId} />
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
        <input type="hidden" name="projectId" value={projectId} />
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

function AddChecklistItemForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    addChecklistItemAction,
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      // Clear the input on success so you can chain entries quickly.
      inputRef.current?.form?.reset();
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
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
