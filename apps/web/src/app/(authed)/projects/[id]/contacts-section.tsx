'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import {
  addProjectContactAction,
  removeProjectContactAction,
  type SaveResult,
} from './contact-actions';
import type { ProjectContactRef } from '@/lib/api';

// Client / contacts area for the project detail (Addendum 05).
//
// Company + primary contact are read-only links surfaced from the
// project record. Additional contacts (the project ↔ people join) are
// managed inline: a person picker (existing people passed down from the
// server) drives projectsApi.contacts.add, and each row has a remove.
//
// The picker only lists people not already attached — no point offering a
// dup that the server would reject. `+ Add contact` toggles the form so
// the resting state stays quiet.

type PickerPerson = { id: string; name: string; role_at_company: string | null };

export function ContactsSection({
  projectId,
  company,
  primaryContact,
  contacts,
  people,
}: {
  projectId: string;
  company: { id: string; name: string } | null;
  primaryContact:
    | { id: string; name: string; email: string | null; role_at_company: string | null }
    | null;
  contacts: ProjectContactRef[];
  people: PickerPerson[];
}) {
  const hasAnything = company || primaryContact || contacts.length > 0;

  return (
    <section className="mt-6 first:mt-0">
      <div className="eyebrow pb-2 border-b border-line mb-3">Client / contacts</div>

      {(company || primaryContact) && (
        <dl className="mb-2">
          {company && (
            <div className="flex items-baseline gap-3 py-1.5">
              <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-3 w-24 shrink-0">
                Company
              </dt>
              <dd className="font-sans text-[14px] text-ink">
                <Link
                  href={`/companies/${company.id}`}
                  className="hover:text-accent transition-colors"
                >
                  {company.name}
                </Link>
              </dd>
            </div>
          )}
          {primaryContact && (
            <div className="flex items-baseline gap-3 py-1.5">
              <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-3 w-24 shrink-0">
                Primary
              </dt>
              <dd className="font-sans text-[14px] text-ink">
                <Link
                  href={`/people/${primaryContact.id}`}
                  className="hover:text-accent transition-colors"
                >
                  {primaryContact.name}
                </Link>
                {primaryContact.role_at_company && (
                  <span className="text-ink-3">
                    {' '}
                    · {primaryContact.role_at_company}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      <div className="mb-3">
        {contacts.length > 0 ? (
          <ul>
            {contacts.map((c) => (
              <ContactRow key={c.id} projectId={projectId} contact={c} />
            ))}
          </ul>
        ) : !hasAnything ? (
          <p className="font-sans text-[13px] text-ink-3 italic py-1">
            No client or contacts yet.
          </p>
        ) : null}
      </div>

      <AddContactForm projectId={projectId} contacts={contacts} people={people} />
    </section>
  );
}

function ContactRow({
  projectId,
  contact,
}: {
  projectId: string;
  contact: ProjectContactRef;
}) {
  const person = contact.person;
  return (
    <li className="flex items-baseline gap-3 py-3 border-b border-line/40 group">
      <span className="flex-1 font-sans text-[14px] text-ink">
        {person ? (
          <Link
            href={`/people/${person.id}`}
            className="hover:text-accent transition-colors"
          >
            {person.name}
          </Link>
        ) : (
          <span className="text-ink-3 italic">Unknown person</span>
        )}
        {(contact.role || person?.role_at_company) && (
          <span className="text-ink-3">
            {' '}
            · {contact.role || person?.role_at_company}
          </span>
        )}
      </span>
      <form
        action={removeProjectContactAction}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="contactId" value={contact.id} />
        <button
          type="submit"
          aria-label="Remove contact"
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          ✕
        </button>
      </form>
    </li>
  );
}

function AddContactForm({
  projectId,
  contacts,
  people,
}: {
  projectId: string;
  contacts: ProjectContactRef[];
  people: PickerPerson[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    addProjectContactAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // People already attached (or the primary, which lives elsewhere) would
  // just error on add — filter them out of the picker.
  const attachedIds = new Set(
    contacts.map((c) => c.person?.id).filter((id): id is string => Boolean(id)),
  );
  const available = people.filter((p) => !attachedIds.has(p.id));

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
      >
        + Add contact
      </button>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <select
        name="person_id"
        required
        defaultValue=""
        disabled={pending || available.length === 0}
        className="flex-1 min-w-[160px] bg-transparent border border-line focus:border-ink-2 focus:outline-none px-2 py-1.5 font-sans text-[14px] text-ink"
      >
        <option value="" disabled>
          {available.length === 0 ? 'No people available…' : 'Select a person…'}
        </option>
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.role_at_company ? ` · ${p.role_at_company}` : ''}
          </option>
        ))}
      </select>
      <input
        type="text"
        name="role"
        placeholder="Role (optional)"
        autoComplete="off"
        disabled={pending}
        className="min-w-[120px] bg-transparent border border-line focus:border-ink-2 focus:outline-none px-2 py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-3/70"
      />
      <button
        type="submit"
        disabled={pending || available.length === 0}
        className="px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider bg-ink text-bg border-ink hover:opacity-80 transition-opacity disabled:opacity-40"
      >
        {pending ? 'Adding…' : 'Add'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider border-line text-ink-2 hover:border-ink-2 hover:text-ink transition-colors"
      >
        Cancel
      </button>
      {state && !state.ok && (
        <span className="font-mono text-[10px] uppercase text-accent w-full">{state.error}</span>
      )}
    </form>
  );
}
