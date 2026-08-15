'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { createCompanyAction, updateCompanyAction, deleteCompanyAction, type SaveResult } from './actions';
import type { CompanyRelationshipType } from '@/lib/api';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';

// Shared form between /companies/new and /companies/[id]/edit. Switches
// modes via the presence of initial.id. Mirrors people/person-form.tsx.

const RELATIONSHIPS: Array<{ value: CompanyRelationshipType; label: string }> = [
  { value: 'active_client', label: 'Active client' },
  { value: 'past_client', label: 'Past client' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'partner', label: 'Partner' },
  { value: 'brand_deal', label: 'Brand deal' },
  { value: 'other', label: 'Other' },
];

export interface CompanyFormInitial {
  id?: string;
  name: string;
  relationship_type: CompanyRelationshipType | '';
  domain_id: string;
  website: string;
  primary_email: string;
  primary_phone: string;
  first_engagement_at: string;
  next_review_at: string;
  checkin_interval_days: number | null;
  notes: string;
  active: boolean;
}

export function CompanyForm({
  initial,
  domains,
}: {
  initial: CompanyFormInitial;
  domains: Array<{ id: string; name: string }>;
}) {
  const isEdit = Boolean(initial.id);
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    isEdit ? updateCompanyAction : createCompanyAction,
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
            autoComplete="organization"
            className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[15px] text-ink"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <Field label="Domain">
            <select
              name="domain_id"
              defaultValue={initial.domain_id}
              className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            >
              <option value="">— none —</option>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Website">
          <input
            type="text"
            name="website"
            defaultValue={initial.website}
            placeholder="https://…"
            className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink placeholder:text-ink-3/60"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Primary email">
            <input
              type="email"
              name="primary_email"
              defaultValue={initial.primary_email}
              className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            />
          </Field>
          <Field label="Primary phone">
            <input
              type="tel"
              name="primary_phone"
              defaultValue={initial.primary_phone}
              className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="First engagement">
            <input
              type="date"
              name="first_engagement_at"
              defaultValue={initial.first_engagement_at}
              className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            />
          </Field>
          <Field label="Next review">
            <input
              type="date"
              name="next_review_at"
              defaultValue={initial.next_review_at}
              className="w-full bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink"
            />
          </Field>
        </div>

        <Field label="Check-in cadence">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-sans text-[14px] text-ink-2">Check in every</span>
            <input
              type="number"
              name="checkin_interval_days"
              min={1}
              defaultValue={initial.checkin_interval_days ?? ''}
              placeholder="30"
              className="w-20 bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink text-center"
            />
            <span className="font-sans text-[14px] text-ink-2">days</span>
          </div>
          <span className="font-sans text-[12px] text-ink-3 mt-1">
            Past this, an active client surfaces under Silent Clients on Today. Blank → 30 days.
          </span>
        </Field>

        <Field label="Notes">
          <textarea
            name="notes"
            defaultValue={initial.notes}
            rows={4}
            placeholder="Business context, how the relationship started, ongoing themes…"
            className="w-full bg-transparent border border-line focus:border-accent focus:outline-none p-3 font-sans text-[14px] text-ink resize-none placeholder:text-ink-3/60"
          />
        </Field>

        {isEdit && (
          <label className="flex items-center gap-2">
            {/* Hidden 'false' companion: an unchecked checkbox is omitted from
                FormData entirely, so without this, unchecking Active can't be
                distinguished from "field absent" and deactivation silently
                no-ops. readFields() reads getAll('active') and treats the
                presence of 'on' as true. */}
            <input type="hidden" name="active" value="false" />
            <input
              type="checkbox"
              name="active"
              defaultChecked={initial.active}
              className="accent-ink"
            />
            <span className="font-sans text-[13px] text-ink-2">Active</span>
          </label>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 bg-ink text-bg font-mono text-[11px] uppercase tracking-wider hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create company'}
          </button>
          {isEdit && (
            <Link
              href={`/companies/${initial.id}`}
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
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">✓ Saved</span>
          )}
        </div>
      </form>

      {isEdit && initial.id && (
        <div className="mt-8 pt-4 border-t border-line max-w-xl">
          <div className="eyebrow mb-2 text-accent">Danger zone</div>
          <form
            action={deleteCompanyAction}
            onSubmit={(e) => {
              if (!confirm(`Delete ${initial.name}? Contacts + projects stay but are unlinked from this company.`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={initial.id} />
            <button
              type="submit"
              className="px-3 py-1.5 border border-accent text-accent font-mono text-[10px] uppercase tracking-wider hover:bg-accent hover:text-bg transition-colors"
            >
              Delete company
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
