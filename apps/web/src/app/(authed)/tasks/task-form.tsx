'use client';

import { useActionState, useState } from 'react';
import { useTransientSaveResult } from '@/lib/use-transient-save-result';
import { DateInput } from '@/components/DateInput';
import { TimeInput } from '@/components/TimeInput';
import { useFormStatus } from 'react-dom';
import {
  createTaskFullAction,
  updateTaskAction,
  deleteTaskAction,
  type SaveResult,
} from './[id]/actions';

interface ProjectOption {
  id: string;
  name: string;
  domain_id: string | null;
}
interface DomainOption {
  id: string;
  name: string;
  is_system?: boolean;
}
interface ContentItemOption {
  id: string;
  title: string;
}

// `selection` encodes either a domain pick (`domain:<id>`) or a project
// pick (`project:<id>`). The server action splits it back apart before
// hitting the task API. One field, one decision — keeps the form simple
// while preserving the Addendum 03 picker semantics.
interface InitialValues {
  id?: string;                 // present → edit mode
  title: string;
  notes: string;
  due_date: string;
  due_time: string;
  priority: number;
  selection: string;            // domain:<id> | project:<id> | '' (= Inbox default on create)
  content_item_id: string;
  remind_minutes: number | '';  // '' = no reminder; only effective when due_time is set
  recurrence_rule: string;     // '' = no repeat
}

// Shared form used by /tasks/new (create) and /tasks/[id] (edit). The
// difference is just which server action it submits to + whether the
// delete-row at the bottom renders.
export function TaskForm({
  initial,
  domains,
  projects,
  contentItems,
  subtaskCount = 0,
}: {
  initial: InitialValues;
  domains: DomainOption[];
  projects: ProjectOption[];
  contentItems: ContentItemOption[];
  // Children of this task (edit mode only). Deleting a parent cascade-
  // deletes its subtasks at the DB level, so the confirm step says so.
  subtaskCount?: number;
}) {
  const isEdit = Boolean(initial.id);
  const action = isEdit ? updateTaskAction : createTaskFullAction;
  const [state, formAction] = useActionState<SaveResult | null, FormData>(action, null);
  // Auto-clear success messages so back-to-back saves each show fresh feedback.
  const display = useTransientSaveResult(state);

  return (
    <>
      <form action={formAction} className="flex flex-col gap-5">
        {initial.id && <input type="hidden" name="taskId" value={initial.id} />}

        <Field label="Title (required)">
          <input
            type="text"
            name="title"
            required
            autoComplete="off"
            defaultValue={initial.title}
            className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none py-1.5 font-sans text-[15px] text-ink"
          />
        </Field>

        <Field label="Notes">
          <textarea
            name="notes"
            rows={3}
            defaultValue={initial.notes}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink resize-y"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Due date">
            <DateInput
              name="due_date"
              defaultValue={initial.due_date}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            />
          </Field>
          <Field label="Due time">
            <TimeInput
              name="due_time"
              defaultValue={initial.due_time}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Priority">
            <select
              name="priority"
              defaultValue={String(initial.priority)}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            >
              <option value="1">1 · Urgent</option>
              <option value="2">2 · High</option>
              <option value="3">3 · Medium</option>
              <option value="4">4 · Low (default)</option>
            </select>
          </Field>
          <Field label="Domain / Project">
            <DomainProjectPicker
              domains={domains}
              projects={projects}
              defaultValue={initial.selection}
            />
          </Field>
        </div>

        <Field label="Content item (optional — for video / article / podcast tasks)">
          <select
            name="content_item_id"
            defaultValue={initial.content_item_id}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            <option value="">(none)</option>
            {contentItems.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </Field>

        <Field label="Remind me (Pushover; requires a due time)">
          <select
            name="remind_minutes"
            defaultValue={initial.remind_minutes === '' ? '' : String(initial.remind_minutes)}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            <option value="">No reminder</option>
            <option value="0">At due time</option>
            <option value="5">5 minutes before</option>
            <option value="15">15 minutes before</option>
            <option value="30">30 minutes before</option>
            <option value="60">1 hour before</option>
          </select>
        </Field>

        <Field label="Repeat (recurring tasks roll forward on done instead of completing)">
          <select
            name="recurrence_rule"
            defaultValue={initial.recurrence_rule}
            className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            <option value="">Doesn&rsquo;t repeat</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays (Mon-Fri)</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Every 3 months</option>
            <option value="semiannually">Every 6 months</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>

        {display && (
          <div
            className={`font-mono text-[11px] uppercase tracking-wider ${
              display.ok ? 'text-ink-2' : 'text-accent'
            }`}
          >
            {display.ok ? 'Saved.' : display.error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <SaveButton isEdit={isEdit} />
        </div>
      </form>

      {isEdit && initial.id && (
        <DeleteRow taskId={initial.id} title={initial.title} subtaskCount={subtaskCount} />
      )}
    </>
  );
}

// Grouped picker: Inbox at top, then each domain as an <optgroup> containing
// the domain itself (selectable to create a direct-domain task) followed by
// any projects under it. System domains other than Inbox aren't expected in
// the data set; if any show up, they're filtered out — only Inbox earns the
// dedicated top slot.
function DomainProjectPicker({
  domains,
  projects,
  defaultValue,
}: {
  domains: DomainOption[];
  projects: ProjectOption[];
  defaultValue: string;
}) {
  const inbox = domains.find((d) => d.is_system);
  const userDomains = domains.filter((d) => !d.is_system);
  // Group projects under their domain so the optgroup can render them
  // inline. Projects without a domain (orphans) get a final ungrouped
  // section so they're still pickable.
  const projectsByDomain = new Map<string, ProjectOption[]>();
  const orphanProjects: ProjectOption[] = [];
  for (const p of projects) {
    if (p.domain_id) {
      const list = projectsByDomain.get(p.domain_id) ?? [];
      list.push(p);
      projectsByDomain.set(p.domain_id, list);
    } else {
      orphanProjects.push(p);
    }
  }
  return (
    <select
      name="selection"
      defaultValue={defaultValue}
      className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
    >
      {inbox && (
        <option value={`domain:${inbox.id}`}>📥 Inbox (default — for unsorted tasks)</option>
      )}
      {userDomains.map((d) => {
        const projects = projectsByDomain.get(d.id) ?? [];
        return (
          <optgroup key={d.id} label={d.name}>
            <option value={`domain:${d.id}`}>{d.name} (domain)</option>
            {projects.map((p) => (
              <option key={p.id} value={`project:${p.id}`}>{p.name}</option>
            ))}
          </optgroup>
        );
      })}
      {orphanProjects.length > 0 && (
        <optgroup label="Other projects">
          {orphanProjects.map((p) => (
            <option key={p.id} value={`project:${p.id}`}>{p.name}</option>
          ))}
        </optgroup>
      )}
    </select>
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
      {pending ? 'Saving…' : isEdit ? 'Save' : 'Add task'}
    </button>
  );
}

function DeleteRow({
  taskId,
  title,
  subtaskCount = 0,
}: {
  taskId: string;
  title: string;
  subtaskCount?: number;
}) {
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
          Delete task…
        </button>
      ) : (
        <form action={deleteTaskAction} className="flex items-center gap-3 flex-wrap">
          <input type="hidden" name="taskId" value={taskId} />
          <span className="font-sans text-[13px] text-ink-2">
            Delete &ldquo;{title}&rdquo; permanently?
            {subtaskCount > 0 && (
              <>
                {' '}
                <span className="text-accent">
                  This also deletes its {subtaskCount} subtask{subtaskCount === 1 ? '' : 's'}.
                </span>
              </>
            )}
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
