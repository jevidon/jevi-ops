'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { saveProjectAsTemplate } from '../../task-templates/actions';

export function SaveTaskTemplate({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(projectName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const submitting = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError('');
    try {
      const result = await saveProjectAsTemplate({ project_id: projectId, name });
      if (result.ok) { setSaved(result.value.name); setOpen(false); }
      else setError(result.error);
    } catch { setError('Could not save the template. Please try again.'); }
    finally { submitting.current = false; setPending(false); }
  }

  return <div className="mb-4">
    {!open && <button type="button" className="min-h-11 text-sm text-accent underline" onClick={() => { setSaved(null); setError(''); setOpen(true); }}>Save as task template</button>}
    {saved && <p role="status" className="text-sm text-ink-2">Saved “{saved}”. Your project is unchanged. <Link className="text-accent underline" href="/task-templates">View task templates</Link></p>}
    {open && <form onSubmit={submit} className="rounded border border-line p-4">
      <fieldset disabled={pending} className="space-y-3">
        <label className="block text-sm">Template name
          <input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded border border-line bg-transparent p-2.5 text-base" />
        </label>
        <p className="text-sm text-ink-2">Save all project tasks, including completed tasks, with their notes and subtasks. New projects start incomplete, without old dates or reminders. Your original project stays as it is.</p>
        {error && <p role="alert" className="text-sm text-accent">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="min-h-11 rounded bg-ink px-4 py-2 text-sm text-bg disabled:opacity-50">{pending ? 'Saving…' : 'Save template'}</button>
          <button type="button" className="min-h-11 rounded border border-line px-4 py-2 text-sm" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </fieldset>
    </form>}
  </div>;
}
