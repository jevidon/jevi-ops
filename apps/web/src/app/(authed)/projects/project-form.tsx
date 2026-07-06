'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createProjectAction, updateProjectAction, deleteProjectAction, type SaveResult } from './actions';
import { PROJECT_COLOR_PALETTE } from '@jevi-ops/shared';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';
import { DateInput } from '@/components/DateInput';

interface DomainOption {
  id: string;
  name: string;
}

interface InitialValues {
  id?: string;            // present → edit mode
  name: string;
  description: string;
  domain_id: string;
  type: '' | 'client' | 'internal' | 'content';
  status: 'active' | 'paused' | 'done' | 'archived';
  engagement_type: 'project' | 'retainer';
  kind: 'project' | 'area';
  quoted_hours: string;   // input value is always string
  start_date: string;
  target_date: string;
  color: string;
}

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '(none)' },
  { value: 'client', label: 'Client' },
  { value: 'internal', label: 'Internal' },
  { value: 'content', label: 'Content' },
];

const STATUS_OPTIONS: Array<{ value: 'active' | 'paused' | 'done' | 'archived'; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];

export function ProjectForm({
  initial,
  domains,
}: {
  initial: InitialValues;
  domains: DomainOption[];
}) {
  const isEdit = Boolean(initial.id);
  const action = isEdit ? updateProjectAction : createProjectAction;
  const [state, formAction] = useActionState<SaveResult | null, FormData>(action, null);
  // Auto-clear success messages so consecutive saves each get fresh feedback.
  const display = useTransientSaveResult(state);
  const [color, setColor] = useState(initial.color);
  // Controlled so the form can hide/show fields that don't apply to areas
  // (target date, hours, engagement type — all project-only concepts).
  const [kind, setKind] = useState<'project' | 'area'>(initial.kind);
  const isArea = kind === 'area';

  return (
    <>
      <form action={formAction} className="flex flex-col gap-5">
        {initial.id && <input type="hidden" name="id" value={initial.id} />}
        {/* Color is set by the swatch picker below; mirror it into a hidden input. */}
        <input type="hidden" name="color" value={color} />
        {/* Kind toggle hidden field — actual UI lives below. */}
        <input type="hidden" name="kind" value={kind} />

        {/* Type toggle — project (finite, has milestones + target date)
            vs area (ongoing context like Home, Garage, Health). Areas
            hide the engagement, target date, and quoted-hours fields
            since none of those apply. */}
        <Field label="Type">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setKind('project')}
              className={`flex-1 px-3 py-2 border text-left transition-colors ${
                kind === 'project'
                  ? 'border-ink bg-surface-2/50'
                  : 'border-line hover:border-ink-2'
              }`}
            >
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mb-0.5">
                Project
              </div>
              <div className="font-sans text-[13px] text-ink">
                Finite outcome · milestones + target date
              </div>
            </button>
            <button
              type="button"
              onClick={() => setKind('area')}
              className={`flex-1 px-3 py-2 border text-left transition-colors ${
                kind === 'area'
                  ? 'border-ink bg-surface-2/50'
                  : 'border-line hover:border-ink-2'
              }`}
            >
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mb-0.5">
                Area
              </div>
              <div className="font-sans text-[13px] text-ink">
                Ongoing context · Home, Garage, Health…
              </div>
            </button>
          </div>
        </Field>

        <Field label="Name (required)">
          <input
            type="text"
            name="name"
            required
            autoComplete="off"
            defaultValue={initial.name}
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[15px] text-ink"
          />
        </Field>

        <Field label="Description">
          <textarea
            name="description"
            rows={2}
            defaultValue={initial.description}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
          />
        </Field>

        {/* Engagement: project (bounded, has milestones) vs retainer
            (ongoing, no milestones, monthly hours rollup). Drives the
            project list section + detail page layout. N/A for areas —
            areas aren't billed and have no client. */}
        {!isArea && (
          <Field label="Engagement">
            <div className="flex gap-2">
              <label className="flex-1">
                <input
                  type="radio"
                  name="engagement_type"
                  value="project"
                  defaultChecked={initial.engagement_type === 'project'}
                  className="peer sr-only"
                />
                <div className="px-3 py-2 border border-line peer-checked:border-ink peer-checked:bg-surface-2/50 font-sans text-[13px] text-ink cursor-pointer transition-colors">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mb-0.5">Project</div>
                  Bounded · milestones + target date
                </div>
              </label>
              <label className="flex-1">
                <input
                  type="radio"
                  name="engagement_type"
                  value="retainer"
                  defaultChecked={initial.engagement_type === 'retainer'}
                  className="peer sr-only"
                />
                <div className="px-3 py-2 border border-line peer-checked:border-ink peer-checked:bg-surface-2/50 font-sans text-[13px] text-ink cursor-pointer transition-colors">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mb-0.5">Retainer</div>
                  Ongoing · monthly hours, no milestones
                </div>
              </label>
            </div>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Domain">
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
        </div>

        {isEdit && (
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
        )}

        {!isArea && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start date">
              <DateInput
                name="start_date"
                defaultValue={initial.start_date}
                className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
              />
            </Field>
            <Field label="Target date">
              <DateInput
                name="target_date"
                defaultValue={initial.target_date}
                className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
              />
            </Field>
          </div>
        )}

        {!isArea && (
          <Field
            label={
              initial.engagement_type === 'retainer'
                ? 'Monthly hours cap (decimal OK)'
                : 'Quoted hours (decimal OK)'
            }
          >
            <input
              type="number"
              step="0.25"
              min="0"
              name="quoted_hours"
              defaultValue={initial.quoted_hours}
              placeholder={initial.engagement_type === 'retainer' ? 'e.g. 20' : 'optional'}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            />
          </Field>
        )}

        <Field label="Color">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setColor('')}
              className={`h-7 w-7 border-2 flex items-center justify-center font-mono text-[10px] ${
                color === '' ? 'border-ink' : 'border-line hover:border-ink-2'
              }`}
              title="No color"
            >
              —
            </button>
            {PROJECT_COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-7 w-7 border-2 ${color === c ? 'border-ink' : 'border-line hover:border-ink-2'}`}
                style={{ backgroundColor: c }}
                title={c}
                aria-label={`Select color ${c}`}
              />
            ))}
          </div>
        </Field>

        {display && (
          <div className={`font-mono text-[11px] uppercase tracking-wider ${display.ok ? 'text-ink-2' : 'text-accent'}`}>
            {display.ok ? 'Saved.' : display.error}
          </div>
        )}

        <div className="pt-2">
          <SaveButton isEdit={isEdit} kind={kind} />
        </div>
      </form>

      {isEdit && initial.id && (
        <DeleteRow projectId={initial.id} name={initial.name} kind={kind} />
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

function SaveButton({ isEdit, kind }: { isEdit: boolean; kind: 'project' | 'area' }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2.5 transition-colors"
    >
      {pending ? 'Saving…' : isEdit ? 'Save' : kind === 'area' ? 'Create area' : 'Create project'}
    </button>
  );
}

function DeleteRow({ projectId, name, kind }: { projectId: string; name: string; kind: 'project' | 'area' }) {
  const [confirming, setConfirming] = useState(false);
  const label = kind === 'area' ? 'area' : 'project';
  return (
    <div className="mt-12 pt-6 border-t border-line">
      <div className="eyebrow mb-3">Danger zone</div>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          Delete {label}…
        </button>
      ) : (
        <form action={deleteProjectAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={projectId} />
          <span className="font-sans text-[13px] text-ink-2">
            Delete &ldquo;{name}&rdquo;? Linked tasks stay (just unlinked).
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
