'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { createPersonAction, updatePersonAction, deletePersonAction, type SaveResult } from './actions';
import type { RelationshipType } from '@/lib/api';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';

// Shared form between /people/new and /people/[id] edit. Switches modes
// via the presence of `initial.id`. Used directly on the new page and
// nested inside a <details> on the detail page.

const RELATIONSHIPS: Array<{ value: RelationshipType; label: string }> = [
  { value: 'client', label: 'Client' },
  { value: 'family', label: 'Family' },
  { value: 'church', label: 'Church' },
  { value: 'friend', label: 'Friend' },
  { value: 'team', label: 'Team' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'other', label: 'Other' },
];

export interface PersonFormInitial {
  id?: string;
  name: string;
  relationship_type: RelationshipType | '';
  email: string;
  phone: string;
  company: string;
  notes: string;
}

export function PersonForm({ initial }: { initial: PersonFormInitial }) {
  const isEdit = Boolean(initial.id);
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    isEdit ? updatePersonAction : createPersonAction,
    null,
  );
  const display = useTransientSaveResult(state);

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4 max-w-xl">
        {initial.id && <input type="hidden" name="id" value={initial.id} />}

        <Field label="Name" required>
          <input
            type="text"
            name="name"
            defaultValue={initial.name}
            required
            autoComplete="name"
            className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[15px] text-ink"
          />
        </Field>

        <Field label="Relationship">
          <select
            name="relationship_type"
            defaultValue={initial.relationship_type}
            className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          >
            <option value="">— none —</option>
            {RELATIONSHIPS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Email">
            <input
              type="email"
              name="email"
              defaultValue={initial.email}
              autoComplete="email"
              className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              name="phone"
              defaultValue={initial.phone}
              autoComplete="tel"
              className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            />
          </Field>
        </div>

        <Field label="Company / org">
          <input
            type="text"
            name="company"
            defaultValue={initial.company}
            autoComplete="organization"
            className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
          />
        </Field>

        <Field label="Notes">
          <textarea
            name="notes"
            defaultValue={initial.notes}
            rows={4}
            placeholder="How you met, context, ongoing themes…"
            className="w-full bg-transparent border border-line focus:border-accent focus:outline-none p-3 font-sans text-[14px] text-ink resize-none placeholder:text-ink-3/60"
          />
        </Field>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 bg-ink text-bg font-mono text-[11px] uppercase tracking-wider hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create person'}
          </button>
          {isEdit && (
            <Link
              href={`/people/${initial.id}`}
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
            >
              Cancel
            </Link>
          )}
          {display?.ok === false && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
              {display.error}
            </span>
          )}
          {display?.ok === true && isEdit && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
              ✓ Saved
            </span>
          )}
        </div>
      </form>

      {isEdit && initial.id && (
        <div className="mt-8 pt-4 border-t border-line max-w-xl">
          <div className="eyebrow mb-2 text-accent">Danger zone</div>
          <form
            action={deletePersonAction}
            onSubmit={(e) => {
              if (!confirm(`Delete ${initial.name}? Their notes + projects stay; facts + interactions are deleted.`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={initial.id} />
            <button
              type="submit"
              className="px-3 py-1.5 border border-accent text-accent font-mono text-[10px] uppercase tracking-wider hover:bg-accent hover:text-bg transition-colors"
            >
              Delete person
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="eyebrow">
        {label} {required && <span className="text-accent">*</span>}
      </span>
      {children}
    </label>
  );
}
