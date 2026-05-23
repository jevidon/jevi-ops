'use client';

import { useActionState, useState } from 'react';
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
}
interface ContentItemOption {
  id: string;
  title: string;
}

interface InitialValues {
  id?: string;                 // present → edit mode
  title: string;
  notes: string;
  due_date: string;
  due_time: string;
  priority: number;
  project_id: string;
  content_item_id: string;
  remind_minutes: number | '';  // '' = no reminder; only effective when due_time is set
}

// Shared form used by /tasks/new (create) and /tasks/[id] (edit). The
// difference is just which server action it submits to + whether the
// delete-row at the bottom renders.
export function TaskForm({
  initial,
  projects,
  contentItems,
}: {
  initial: InitialValues;
  projects: ProjectOption[];
  contentItems: ContentItemOption[];
}) {
  const isEdit = Boolean(initial.id);
  const action = isEdit ? updateTaskAction : createTaskFullAction;
  const [state, formAction] = useActionState<SaveResult | null, FormData>(action, null);

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
            <input
              type="date"
              name="due_date"
              defaultValue={initial.due_date}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            />
          </Field>
          <Field label="Due time">
            <input
              type="time"
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
          <Field label="Project">
            <select
              name="project_id"
              defaultValue={initial.project_id}
              className="w-full bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[14px] text-ink"
            >
              <option value="">(none)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
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
            <option value="5">5 minutes before</option>
            <option value="15">15 minutes before</option>
            <option value="30">30 minutes before</option>
            <option value="60">1 hour before</option>
          </select>
        </Field>

        {state && (
          <div
            className={`font-mono text-[11px] uppercase tracking-wider ${
              state.ok ? 'text-ink-2' : 'text-accent'
            }`}
          >
            {state.ok ? 'Saved.' : state.error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <SaveButton isEdit={isEdit} />
        </div>
      </form>

      {isEdit && initial.id && (
        <DeleteRow taskId={initial.id} title={initial.title} />
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
      {pending ? 'Saving…' : isEdit ? 'Save' : 'Add task'}
    </button>
  );
}

function DeleteRow({ taskId, title }: { taskId: string; title: string }) {
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
        <form action={deleteTaskAction} className="flex items-center gap-3">
          <input type="hidden" name="taskId" value={taskId} />
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
