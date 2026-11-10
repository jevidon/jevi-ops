'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClientId } from '@/lib/client-id';
import { INBOX_DOMAIN_ID, type TaskTemplate, type TaskTemplateEntry } from '@jevi-ops/shared';
import { createProjectFromTemplate, saveTaskTemplate } from './actions';

const fieldClass = 'block w-full mt-1 rounded border border-line bg-transparent p-2.5 text-base text-ink focus:outline-accent';
const buttonClass = 'inline-flex min-h-11 items-center justify-center rounded border border-line px-4 py-2 text-sm hover:border-ink disabled:opacity-50';
const primaryClass = `${buttonClass} bg-ink text-bg hover:bg-ink-2`;

export function TaskTemplates({ initialTemplates, domains, initialDomainId = '' }: {
  initialTemplates: TaskTemplate[];
  domains: { id: string; name: string }[];
  initialDomainId?: string;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [editor, setEditor] = useState<{ template?: TaskTemplate } | null>(initialTemplates.length ? null : {});
  const [using, setUsing] = useState<TaskTemplate | null>(null);
  const [notice, setNotice] = useState('');

  if (editor) return <TemplateEditor key={editor.template?.id ?? 'new'} template={editor.template}
    onCancel={() => setEditor(null)} onSaved={template => {
      setTemplates(current => [...current.filter(t => t.id !== template.id), template].sort((a, b) => a.name.localeCompare(b.name)));
      setEditor(null);
      setNotice(`Saved “${template.name}”. Existing projects keep their tasks and progress.`);
    }} />;

  if (using) return <ProjectFromTemplate template={using} domains={domains} initialDomainId={initialDomainId}
    onCancel={() => setUsing(null)} onCreated={id => { router.push(`/projects/${id}`); router.refresh(); }} />;

  return <div className="max-w-3xl">
    <button type="button" className={primaryClass} onClick={() => { setNotice(''); setEditor({}); }}>New template</button>
    {notice && <p role="status" className="mt-4 text-sm text-ink-2">{notice}</p>}
    {!templates.length && <p className="mt-6 text-ink-3">No templates yet. Start with a list you use often.</p>}
    <ul className="mt-6 divide-y divide-line border-y border-line">
      {templates.map(template => <li key={template.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="font-serif text-2xl break-words">{template.name}</h2>
          <p className="mt-1 text-sm text-ink-3">{template.entries.length} {template.entries.length === 1 ? 'task' : 'tasks'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} aria-label={`Edit ${template.name}`} onClick={() => { setNotice(''); setEditor({ template }); }}>Edit</button>
          <button type="button" className={primaryClass} aria-label={`Use ${template.name}`} onClick={() => { setNotice(''); setUsing(template); }}>Use template</button>
        </div>
      </li>)}
    </ul>
  </div>;
}

function TemplateEditor({ template, onCancel, onSaved }: { template?: TaskTemplate; onCancel: () => void; onSaved: (template: TaskTemplate) => void }) {
  const [name, setName] = useState(template?.name ?? '');
  const [entries, setEntries] = useState<TaskTemplateEntry[]>(() => template?.entries ?? [blankEntry()]);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const patchEntry = (key: string, patch: Partial<TaskTemplateEntry>) => setEntries(current => current.map(entry => entry.key === key ? { ...entry, ...patch } : entry));
  function removeEntry(entry: TaskTemplateEntry) {
    setEntries(current => current.filter(e => e.key !== entry.key).map(e => e.parent_key === entry.key ? { ...e, parent_key: entry.parent_key } : e));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError('');
    try {
      const result = await saveTaskTemplate({ id: template?.id, revision: template?.revision, name, entries });
      if (result.ok) onSaved(result.value); else setError(result.error);
    } catch { setError('Could not save. Your entries are still here; please try again.'); }
    finally { submitting.current = false; setPending(false); }
  }
  return <form onSubmit={submit} className="max-w-2xl">
    <h2 className="font-serif text-2xl mb-5">{template ? 'Edit template' : 'New template'}</h2>
    <fieldset disabled={pending} className="space-y-5">
      <label className="block text-sm">Template name
        <input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={fieldClass} placeholder="Packing for a flight" />
      </label>
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Tasks ({entries.length} / 200)</h3>
        {entries.map((entry, index) => <div key={entry.key} className="space-y-3 rounded border border-line p-3">
          <label className="block text-sm">Task {index + 1}
            <input required maxLength={500} value={entry.title} onChange={e => patchEntry(entry.key, { title: e.target.value })} className={fieldClass} />
          </label>
          <label className="block text-sm">Parent for task {index + 1}
            <select value={entry.parent_key ?? ''} onChange={e => patchEntry(entry.key, { parent_key: e.target.value || null })} className={fieldClass}>
              <option value="">No parent — main task</option>
              {entries.filter(candidate => canParent(entries, entry.key, candidate.key)).map(candidate => <option key={candidate.key} value={candidate.key}>{candidate.title || 'Untitled task'}</option>)}
            </select>
          </label>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm">Notes{entry.notes ? ' · saved' : ''}</summary>
            <label className="block text-sm">Notes for task {index + 1}
              <textarea rows={3} maxLength={200_000} value={entry.notes ?? ''} onChange={e => patchEntry(entry.key, { notes: e.target.value || null })} className={fieldClass} />
            </label>
          </details>
          <button type="button" className={buttonClass} aria-label={`Remove task ${index + 1}`} onClick={() => removeEntry(entry)}>Remove task</button>
        </div>)}
        <button type="button" className={buttonClass} disabled={entries.length >= 200} onClick={() => setEntries(current => [...current, blankEntry()])}>Add task</button>
        <p className="text-sm text-ink-3">Choose a parent to make a subtask. Removing a task keeps its subtasks and moves them up a level.</p>
      </div>
      <p className="text-sm text-ink-2">Changes apply to future projects. Existing projects keep their own tasks and progress.</p>
      {error && <p role="alert" className="text-sm text-accent">{error}</p>}
      <div className="flex gap-2">
        <button className={primaryClass} type="submit">{pending ? 'Saving…' : 'Save template'}</button>
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
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError('');
    try {
      const result = await createProjectFromTemplate({ template_id: template.id, name, domain_id: domainId });
      if (result.ok) { onCreated(result.value.id); return; }
      setError(result.error);
    } catch { setError('Could not create the project. Your entries are still here; please try again.'); }
    submitting.current = false; setPending(false);
  }
  return <form onSubmit={submit} className="max-w-2xl">
    <h2 className="font-serif text-2xl mb-2">Use {template.name}</h2>
    <p className="mb-5 text-sm text-ink-2">Create a project from the latest saved template. Every task starts incomplete and can be changed independently.</p>
    <fieldset disabled={pending} className="space-y-5">
      <label className="block text-sm">New project name
        <input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={fieldClass} placeholder="US trip — December" />
      </label>
      <label className="block text-sm">Domain
        <select value={domainId} onChange={e => setDomainId(e.target.value)} className={fieldClass}>
          <option value="">Inbox</option>
          {domains.filter(d => d.id !== INBOX_DOMAIN_ID).map(d => <option value={d.id} key={d.id}>{d.name}</option>)}
        </select>
      </label>
      <details className="rounded border border-line p-3">
        <summary className="cursor-pointer text-sm">Preview saved tasks ({template.entries.length})</summary>
        <TemplatePreview entries={template.entries} />
      </details>
      {error && <p role="alert" className="text-sm text-accent">{error}</p>}
      <div className="flex gap-2">
        <button className={primaryClass} type="submit">{pending ? 'Creating…' : 'Create project'}</button>
        <button className={buttonClass} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </fieldset>
  </form>;
}

function blankEntry(): TaskTemplateEntry {
  return { key: createClientId(), title: '', notes: null, parent_key: null };
}

function canParent(entries: TaskTemplateEntry[], key: string, candidateKey: string): boolean {
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  const visited = new Set<string>();
  let current: string | null = candidateKey;
  while (current) {
    if (current === key || visited.has(current)) return false;
    visited.add(current);
    current = byKey.get(current)?.parent_key ?? null;
  }
  return true;
}

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
