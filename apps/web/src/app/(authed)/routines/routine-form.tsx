'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import {
  createRoutineAction,
  updateRoutineAction,
  archiveRoutineAction,
  deleteRoutineAction,
  type SaveResult,
} from './actions';

export interface RoutineFormInitial {
  id?: string;
  name: string;
  description: string;
}

export function RoutineForm({ initial }: { initial: RoutineFormInitial }) {
  const isEdit = Boolean(initial.id);
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    isEdit ? updateRoutineAction : createRoutineAction,
    null,
  );

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4 max-w-xl">
        {initial.id && <input type="hidden" name="id" value={initial.id} />}

        <label className="flex flex-col gap-1">
          <span className="eyebrow">Name <span className="text-accent">*</span></span>
          <input
            type="text"
            name="name"
            defaultValue={initial.name}
            required
            autoComplete="off"
            placeholder="Read the Bible"
            className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[15px] text-ink"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">Description</span>
          <textarea
            name="description"
            defaultValue={initial.description}
            rows={3}
            placeholder="Optional — context, what counts, why you're tracking it…"
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-3 font-sans text-[14px] text-ink resize-none placeholder:text-ink-3/60"
          />
        </label>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 bg-ink text-bg font-mono text-[11px] uppercase tracking-wider hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create routine'}
          </button>
          {isEdit && (
            <Link
              href={`/routines/${initial.id}`}
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
            >
              Cancel
            </Link>
          )}
          {state?.ok === false && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
              {state.error}
            </span>
          )}
          {state?.ok === true && isEdit && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
              ✓ Saved
            </span>
          )}
        </div>
      </form>

      {isEdit && initial.id && (
        <div className="mt-8 pt-4 border-t border-line max-w-xl">
          <div className="eyebrow mb-2">Archive or delete</div>
          <p className="font-sans text-[13px] text-ink-3 mb-3">
            Archiving keeps the streak history but hides the routine from
            today&rsquo;s list. Deleting wipes everything &mdash; including completion
            history.
          </p>
          <div className="flex flex-wrap gap-3">
            <form action={archiveRoutineAction}>
              <input type="hidden" name="id" value={initial.id} />
              <button
                type="submit"
                className="px-3 py-1.5 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors"
              >
                Archive
              </button>
            </form>
            <form
              action={deleteRoutineAction}
              onSubmit={(e) => {
                if (!confirm(`Delete ${initial.name}? Streak history will be lost. (Use Archive instead if you want to keep it.)`)) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="id" value={initial.id} />
              <button
                type="submit"
                className="px-3 py-1.5 border border-accent text-accent font-mono text-[10px] uppercase tracking-wider hover:bg-accent hover:text-bg transition-colors"
              >
                Delete forever
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
