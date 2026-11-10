'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientId } from '@/lib/client-id';
import { useToast } from '@/components/toast/ToastProvider';
import type { TaskTemplate, TaskTemplateEntry } from '@jevi-ops/shared';
import { loadTaskTemplate, saveTaskTemplate, type ActionFailure } from './actions';
import { entryField, untitledWithNotes, withoutBlankTasks, UNTITLED_NOTE_ERROR, UNTITLED_NOTE_FIELD_ERROR } from './template-draft';
import { buttonClass, failed, field, fieldClass, FieldError, primaryClass } from './ui';
import { useLeaveGuard } from './use-leave-guard';

const LIBRARY = '/task-templates';
const snapshot = (name: string, entries: TaskTemplateEntry[]) => JSON.stringify([name, entries]);
const blankEntry = (): TaskTemplateEntry => ({ key: createClientId(), title: '', notes: null, parent_key: null });

// The editor page for one template. `template` is the stored record being
// edited; without it this creates a new one, optionally prefilled from
// `initial` (Duplicate). A prefilled draft is not "unsaved changes": nothing
// the user typed is lost by leaving it.
export function TemplateEditor({ template, initial }: {
  template?: TaskTemplate;
  initial?: { name: string; entries: TaskTemplateEntry[] };
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(template?.name ?? initial?.name ?? '');
  const [entries, setEntries] = useState<TaskTemplateEntry[]>(() => template?.entries ?? initial?.entries ?? [blankEntry()]);
  const [revision, setRevision] = useState(template?.revision);
  const [baseline, setBaseline] = useState(() => snapshot(name, entries));
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const titleInputs = useRef(new Map<string, HTMLInputElement>());
  const nameInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusKey = useRef<string | null>(null);
  const guard = useLeaveGuard(snapshot(name, entries) !== baseline, LIBRARY);
  useEffect(() => {
    if (focusKey.current) { titleInputs.current.get(focusKey.current)?.focus(); focusKey.current = null; }
  }, [entries]);
  // A failed save moves focus to the first marked field. On a long template
  // that field is far above the Save button, so focusing it also scrolls it
  // into view. The effect runs once per failure, not on later edits.
  useEffect(() => {
    const fields = error?.fieldErrors;
    if (!fields) return;
    if (fields.name) { nameInput.current?.focus(); return; }
    const marked = entries.find(entry => fields[entryField(entry.key)]);
    if (marked) titleInputs.current.get(marked.key)?.focus();
    else if (fields.entries) (titleInputs.current.get(entries[0]?.key ?? '') ?? addButton.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  // Local validation keeps an unresolved conflict's revision, so the conflict
  // choices stay on screen while the marked field is fixed.
  const invalid = (message: string, fieldErrors: Record<string, string>) =>
    setError(previous => ({ ...failed(message), fieldErrors, currentRevision: previous?.currentRevision }));
  const patchEntry = (key: string, patch: Partial<TaskTemplateEntry>) => setEntries(current => current.map(entry => entry.key === key ? { ...entry, ...patch } : entry));
  function removeEntry(entry: TaskTemplateEntry) {
    setEntries(current => current.filter(e => e.key !== entry.key).map(e => e.parent_key === entry.key ? { ...e, parent_key: entry.parent_key } : e));
  }
  async function save(expectedRevision = revision) {
    if (submitting.current) return;
    // A note with no title would be dropped along with the blank rows.
    const orphaned = untitledWithNotes(entries);
    if (orphaned.length) { invalid(UNTITLED_NOTE_ERROR, Object.fromEntries(orphaned.map(entry => [entryField(entry.key), UNTITLED_NOTE_FIELD_ERROR]))); return; }
    const kept = withoutBlankTasks(entries);
    if (!kept.length) { invalid('Add at least one task.', { entries: 'Add at least one task.' }); return; }
    submitting.current = true; setPending(true); setError(null);
    try {
      const result = await saveTaskTemplate({ id: template?.id, revision: expectedRevision, name, entries: kept });
      if (result.ok) {
        // Leaving on purpose: the guard must not ask about the draft just saved.
        guard.allow();
        toast({ message: `Saved “${result.value.name}”. Existing projects keep their tasks and progress.` });
        router.replace(LIBRARY);
        router.refresh();
        return;
      }
      setError(result);
    } catch { setError(failed('Could not save. Your entries are still here; please try again.')); }
    submitting.current = false; setPending(false);
  }
  async function discardAndLoad() {
    if (!template || submitting.current) return;
    submitting.current = true; setPending(true);
    try {
      const result = await loadTaskTemplate(template.id);
      if (result.ok) {
        setName(result.value.name); setEntries(result.value.entries); setRevision(result.value.revision); setError(null);
        // The loaded version is the new clean state, so the guard stands down.
        setBaseline(snapshot(result.value.name, result.value.entries));
      } else setError(previous => ({ ...result, currentRevision: previous?.currentRevision }));
    } catch { setError(previous => ({ ...failed('Could not load the saved version. Your edits are still here.'), currentRevision: previous?.currentRevision })); }
    finally { submitting.current = false; setPending(false); }
  }
  const conflict = error?.currentRevision !== undefined;
  return <form onSubmit={event => { event.preventDefault(); if (!conflict) void save(); }} className="max-w-2xl">
    <fieldset disabled={pending} className="space-y-5">
      <label className="block text-sm">Template name
        <input ref={nameInput} autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={field(error?.fieldErrors?.name)} placeholder="Packing for a flight" aria-invalid={Boolean(error?.fieldErrors?.name)} aria-describedby={error?.fieldErrors?.name ? 'template-name-error' : undefined} />
      </label>
      <FieldError id="template-name-error" message={error?.fieldErrors?.name} />
      <div className="space-y-4">
        <h2 className="text-sm font-semibold">Tasks ({entries.length}{entries.length >= 180 ? ' of 200' : ''})</h2>
        <FieldError id="template-entries-error" message={error?.fieldErrors?.entries} />
        {entries.map((entry, index) => {
          const childCount = entries.filter(candidate => candidate.parent_key === entry.key).length;
          const subtasks = `${childCount} ${childCount === 1 ? 'subtask' : 'subtasks'}`;
          const parents = entries.filter(candidate => candidate.key !== entry.key && candidate.parent_key === null);
          const legacyParent = entry.parent_key && !parents.some(parent => parent.key === entry.parent_key);
          const rowError = error?.fieldErrors?.[entryField(entry.key)];
          const rowErrorId = `template-task-error-${entry.key}`;
          return <div key={entry.key} className="space-y-3 rounded border border-line p-3">
            <label className="block text-sm">Task {index + 1}
              <input ref={element => { if (element) titleInputs.current.set(entry.key, element); else titleInputs.current.delete(entry.key); }} maxLength={500} value={entry.title} onChange={e => patchEntry(entry.key, { title: e.target.value })} className={field(rowError)} aria-invalid={Boolean(rowError)} aria-describedby={rowError ? rowErrorId : undefined} />
            </label>
            <FieldError id={rowErrorId} message={rowError} />
            {/* A task with subtasks is a group heading, so it has no parent
                picker. Older templates can hold a subtask that has subtasks
                of its own; project pages show one level, so say so. */}
            {childCount ? <p className="text-sm text-ink-3">{entry.parent_key
              ? `Subtask with ${subtasks} of its own, which project pages do not show.`
              : `Main task · ${subtasks}`}
              {entry.parent_key && <button type="button" className={`${buttonClass} ml-2`} onClick={() => patchEntry(entry.key, { parent_key: null })}>Make main task</button>}
            </p> : <label className="block text-sm">Parent for task {index + 1}
              <select value={entry.parent_key ?? ''} onChange={e => patchEntry(entry.key, { parent_key: e.target.value || null })} className={fieldClass}>
                <option value="">No parent — main task</option>
                {legacyParent && <option value={entry.parent_key!} disabled>{entries.find(parent => parent.key === entry.parent_key)?.title || 'Existing parent'} (existing nested parent)</option>}
                {parents.map(parent => <option key={parent.key} value={parent.key}>{parent.title.trim() || `Task ${entries.indexOf(parent) + 1} (untitled)`}</option>)}
              </select>
            </label>}
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm">Notes{entry.notes ? ' · has a note' : ''}</summary>
              <label className="block text-sm">Notes for task {index + 1}
                <textarea rows={3} maxLength={200_000} value={entry.notes ?? ''} onChange={e => patchEntry(entry.key, { notes: e.target.value || null })} className={fieldClass} />
              </label>
            </details>
            <button type="button" className={buttonClass} aria-label={`Remove task ${index + 1}`} onClick={() => removeEntry(entry)}>Remove task</button>
          </div>;
        })}
        <button ref={addButton} type="button" className={buttonClass} disabled={entries.length >= 200} onClick={() => { const entry = blankEntry(); focusKey.current = entry.key; setEntries(current => [...current, entry]); }}>Add task</button>
        <p className="text-sm text-ink-3">Choose a main task as the parent of a subtask. Removing a task keeps its subtasks and moves them up a level.</p>
      </div>
      <p className="text-sm text-ink-2">Changes apply to future projects. Existing projects keep their own tasks and progress.</p>
      {error && <p role="alert" className="text-sm text-accent">{error.error}</p>}
      <div className="flex flex-wrap gap-2">
        {conflict ? <>
          <button className={primaryClass} type="button" onClick={() => save(error!.currentRevision)}>{pending ? 'Working…' : 'Save mine over it'}</button>
          <button className={buttonClass} type="button" onClick={discardAndLoad}>Discard mine, load saved version</button>
        </> : <button className={primaryClass} type="submit">{pending ? 'Saving…' : 'Save template'}</button>}
        {/* A link, so the leave guard asks before discarding a dirty draft. */}
        <Link href={LIBRARY} className={buttonClass}>Cancel</Link>
      </div>
    </fieldset>
    {guard.dialog}
  </form>;
}
