'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { INBOX_DOMAIN_ID, type TaskTemplate, type TaskTemplateEntry } from '@jevi-ops/shared';
import { createProjectFromTemplate, type ActionFailure } from './actions';
import { buttonClass, failed, field, FieldError, primaryClass } from './ui';

// The "Use template" form: a new project from one template, with a name and
// a domain. It opens in place of the library list.
export function ProjectFromTemplate({ template, domains, initialDomainId, onCancel, onCreated }: {
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
