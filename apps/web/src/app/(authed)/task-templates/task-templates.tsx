'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClientId } from '@/lib/client-id';
import { INBOX_DOMAIN_ID, type TaskTemplate, type TaskTemplateEntry } from '@jevi-ops/shared';
import { createProjectFromTemplate, deleteTaskTemplate, loadTaskTemplate, saveTaskTemplate, type ActionFailure } from './actions';
import { entryField, untitledWithNotes, withoutBlankTasks, UNTITLED_NOTE_ERROR, UNTITLED_NOTE_FIELD_ERROR } from './template-draft';

// A field that failed validation swaps its hairline for the accent border, so
// "Check the marked fields" points at something visible. One border colour
// per state: two colour utilities on one element resolve by stylesheet order.
const fieldBase = 'block w-full mt-1 rounded border bg-transparent p-2.5 text-base text-ink focus:outline-accent';
const fieldClass = `${fieldBase} border-line`;
const field = (invalid?: unknown) => invalid ? `${fieldBase} border-accent` : fieldClass;
const buttonClass = 'inline-flex min-h-11 items-center justify-center rounded border border-line px-4 py-2 text-sm hover:border-ink disabled:opacity-50';
const primaryClass = `${buttonClass} bg-ink text-bg hover:bg-ink-2`;
// Destructive row action: full-height target, no border, so it does not sit
// at the same weight as Use and Edit.
const quietClass = 'inline-flex min-h-11 items-center px-2 text-sm text-ink-2 underline-offset-4 hover:text-accent hover:underline disabled:opacity-50';
const failed = (error: string): ActionFailure => ({ ok: false, error });

export function TaskTemplates({ initialTemplates, domains, initialDomainId = '' }: {
  initialTemplates: TaskTemplate[];
  domains: { id: string; name: string }[];
  initialDomainId?: string;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [editor, setEditor] = useState<{ template?: TaskTemplate } | null>(null);
  const [using, setUsing] = useState<TaskTemplate | null>(null);
  const [notice, setNotice] = useState('');
  const remember = (template: TaskTemplate) => setTemplates(current => [...current.filter(t => t.id !== template.id), template].sort((a, b) => a.name.localeCompare(b.name)));

  if (editor) return <TemplateEditor key={editor.template?.id ?? 'new'} template={editor.template}
    onLoaded={remember} onCancel={() => setEditor(null)} onSaved={template => {
      remember(template);
      setEditor(null);
      setNotice(`Saved “${template.name}”. Existing projects keep their tasks and progress.`);
    }} />;

  if (using) return <ProjectFromTemplate template={using} domains={domains} initialDomainId={initialDomainId}
    onCancel={() => setUsing(null)} onCreated={id => { router.push(`/projects/${id}`); router.refresh(); }} />;

  return <div className="max-w-3xl">
    <button type="button" className={primaryClass} onClick={() => { setNotice(''); setEditor({}); }}>New template</button>
    {notice && <p role="status" className="mt-4 text-sm text-ink-2">{notice}</p>}
    {!templates.length ? <p className="mt-6 text-ink-3">Or open any project and choose Save as template in its Tasks section.</p> :
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {templates.map(template => <TemplateRow key={template.id} template={template}
          onEdit={() => { setNotice(''); setEditor({ template }); }}
          onUse={() => { setNotice(''); setUsing(template); }}
          onDeleted={() => { setTemplates(current => current.filter(t => t.id !== template.id)); setNotice(`Deleted “${template.name}”. Existing projects are unchanged.`); }} />)}
      </ul>}
  </div>;
}

function TemplateRow({ template, onEdit, onUse, onDeleted }: { template: TaskTemplate; onEdit: () => void; onUse: () => void; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const deleting = useRef(false);
  const questionId = useId();
  const deleteButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  // Opening the confirmation unmounts the button that had focus. Move focus
  // to Cancel (the safe choice), and back to Delete when the panel closes.
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
    else if (wasConfirming.current) deleteButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  async function remove() {
    if (deleting.current) return;
    deleting.current = true; setPending(true); setError('');
    try {
      const result = await deleteTaskTemplate(template.id);
      if (result.ok) onDeleted(); else setError(result.error);
    } catch { setError('Could not delete this template. Please try again.'); }
    finally { deleting.current = false; setPending(false); }
  }
  return <li className="py-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1 basis-48">
        <h2 className="font-serif text-2xl break-words">{template.name}</h2>
        <p className="mt-1 text-sm text-ink-3">{template.entries.length} {template.entries.length === 1 ? 'task' : 'tasks'}</p>
      </div>
      {!confirming && <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} aria-label={`Use ${template.name}`} onClick={onUse}>Use template</button>
        <button type="button" className={buttonClass} aria-label={`Edit ${template.name}`} onClick={onEdit}>Edit</button>
        <button ref={deleteButton} type="button" className={quietClass} aria-label={`Delete ${template.name}`} onClick={() => setConfirming(true)}>Delete</button>
      </div>}
    </div>
    {confirming && <div role="group" aria-labelledby={questionId} className="mt-3 space-y-3 rounded border border-line p-3">
      <p id={questionId} className="text-sm text-ink-2">Delete “{template.name}”? Projects created from it keep their tasks and progress.</p>
      {error && <p role="alert" className="text-sm text-accent">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} className={`${buttonClass} text-accent`} onClick={remove}>{pending ? 'Deleting…' : 'Confirm delete'}</button>
        <button ref={cancelButton} type="button" disabled={pending} className={buttonClass} onClick={() => { setConfirming(false); setError(''); }}>Cancel</button>
      </div>
    </div>}
  </li>;
}

function TemplateEditor({ template, onCancel, onSaved, onLoaded }: {
  template?: TaskTemplate; onCancel: () => void; onSaved: (template: TaskTemplate) => void; onLoaded: (template: TaskTemplate) => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [entries, setEntries] = useState<TaskTemplateEntry[]>(() => template?.entries ?? [blankEntry()]);
  const [revision, setRevision] = useState(template?.revision);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const titleInputs = useRef(new Map<string, HTMLInputElement>());
  const nameInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusKey = useRef<string | null>(null);
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
      if (result.ok) onSaved(result.value); else setError(result);
    } catch { setError(failed('Could not save. Your entries are still here; please try again.')); }
    finally { submitting.current = false; setPending(false); }
  }
  async function discardAndLoad() {
    if (!template || submitting.current) return;
    submitting.current = true; setPending(true);
    try {
      const result = await loadTaskTemplate(template.id);
      if (result.ok) {
        setName(result.value.name); setEntries(result.value.entries); setRevision(result.value.revision); setError(null); onLoaded(result.value);
      } else setError(previous => ({ ...result, currentRevision: previous?.currentRevision }));
    } catch { setError(previous => ({ ...failed('Could not load the saved version. Your edits are still here.'), currentRevision: previous?.currentRevision })); }
    finally { submitting.current = false; setPending(false); }
  }
  const conflict = error?.currentRevision !== undefined;
  return <form onSubmit={event => { event.preventDefault(); if (!conflict) void save(); }} className="max-w-2xl">
    <h2 className="font-serif text-2xl mb-5">{template ? 'Edit template' : 'New template'}</h2>
    <fieldset disabled={pending} className="space-y-5">
      <label className="block text-sm">Template name
        <input ref={nameInput} autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={field(error?.fieldErrors?.name)} placeholder="Packing for a flight" aria-invalid={Boolean(error?.fieldErrors?.name)} aria-describedby={error?.fieldErrors?.name ? 'template-name-error' : undefined} />
      </label>
      <FieldError id="template-name-error" message={error?.fieldErrors?.name} />
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Tasks ({entries.length}{entries.length >= 180 ? ' of 200' : ''})</h3>
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
        <button className={buttonClass} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </fieldset>
  </form>;
}

function ProjectFromTemplate({ template, domains, initialDomainId, onCancel, onCreated }: {
  template: TaskTemplate; domains: { id: string; name: string }[]; initialDomainId: string;
  onCancel: () => void; onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [domainId, setDomainId] = useState(initialDomainId !== INBOX_DOMAIN_ID && domains.some(d => d.id === initialDomainId) ? initialDomainId : '');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const domainSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (error?.fieldErrors?.name) nameInput.current?.focus();
    else if (error?.fieldErrors?.domain_id) domainSelect.current?.focus();
  }, [error]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError(null);
    try {
      const result = await createProjectFromTemplate({ template_id: template.id, name, domain_id: domainId });
      if (result.ok) { onCreated(result.value.id); return; }
      setError(result);
    } catch { setError(failed('Could not create the project. Your entries are still here; please try again.')); }
    submitting.current = false; setPending(false);
  }
  return <form onSubmit={submit} className="max-w-2xl">
    <h2 className="font-serif text-2xl mb-2">Use {template.name}</h2>
    <p className="mb-5 text-sm text-ink-2">Create a project from the latest saved template. Every task starts incomplete and can be changed independently.</p>
    <fieldset disabled={pending} className="space-y-5">
      <label className="block text-sm">New project name
        <input ref={nameInput} autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={field(error?.fieldErrors?.name)} placeholder="US trip — December" aria-invalid={Boolean(error?.fieldErrors?.name)} aria-describedby={error?.fieldErrors?.name ? 'project-name-error' : undefined} />
      </label>
      <FieldError id="project-name-error" message={error?.fieldErrors?.name} />
      <label className="block text-sm">Domain
        <select ref={domainSelect} value={domainId} onChange={e => setDomainId(e.target.value)} className={field(error?.fieldErrors?.domain_id)} aria-invalid={Boolean(error?.fieldErrors?.domain_id)} aria-describedby={error?.fieldErrors?.domain_id ? 'project-domain-error' : undefined}>
          <option value="">Inbox</option>
          {domains.filter(d => d.id !== INBOX_DOMAIN_ID).map(d => <option value={d.id} key={d.id}>{d.name}</option>)}
        </select>
      </label>
      <FieldError id="project-domain-error" message={error?.fieldErrors?.domain_id} />
      <details className="rounded border border-line p-3">
        <summary className="cursor-pointer text-sm">Preview saved tasks ({template.entries.length})</summary>
        <TemplatePreview entries={template.entries} />
      </details>
      {error && <p role="alert" className="text-sm text-accent">{error.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={primaryClass} type="submit">{pending ? 'Creating…' : 'Create project'}</button>
        <button className={buttonClass} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </fieldset>
  </form>;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="text-sm text-accent">{message}</p> : null;
}
function blankEntry(): TaskTemplateEntry { return { key: createClientId(), title: '', notes: null, parent_key: null }; }
function TemplatePreview({ entries, parent = null }: { entries: TaskTemplateEntry[]; parent?: string | null }) {
  const children = entries.filter(entry => entry.parent_key === parent);
  if (!children.length) return null;
  return <ul className="mt-3 list-disc pl-5 space-y-2 text-sm text-ink-2">
    {children.map(entry => <li key={entry.key} className="break-words">
      {entry.title}
      {entry.notes && <p className="mt-1 whitespace-pre-wrap text-ink-3">{entry.notes}</p>}
      <TemplatePreview entries={entries} parent={entry.key} />
    </li>)}
  </ul>;
}
