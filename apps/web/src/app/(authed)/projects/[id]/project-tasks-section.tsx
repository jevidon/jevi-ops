'use client';

import Link from 'next/link';
import { DetailSection } from '@/components/detail/DetailShell';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { saveProjectAsTemplate } from '../../task-templates/actions';

// The project page's Tasks section. It owns the section header because the
// header's "Save as template" action and the panel it opens share state; the
// page passes the section body (status settings, quick add, task list) as
// children.
export function ProjectTasksSection({ projectId, projectName, count, children }: { projectId: string; projectName: string; count?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(projectName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const submitting = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { nameInput.current?.focus(); nameInput.current?.select(); } }, [open]);

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

  // The trigger keeps the header's quiet 10px mono style; the ::after box
  // widens its hit area to about 44px without changing the header's layout.
  return <DetailSection label="Tasks" count={count} action={
    <button type="button" disabled={pending || open} className="relative font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3 hover:text-ink transition-colors disabled:opacity-50 after:absolute after:inset-x-[-8px] after:inset-y-[-15px] after:content-['']" onClick={() => { setSaved(null); setError(''); setOpen(true); }}>Save as template</button>
  }>
    {saved && <p role="status" className="mb-4 text-sm text-ink-2">Saved “{saved}”. Your project is unchanged. <Link className="text-accent underline" href="/task-templates">View task templates</Link></p>}
    {open && <form onSubmit={submit} className="mb-4 rounded border border-line p-4">
      <fieldset disabled={pending} className="space-y-3">
        <label className="block text-sm">Template name
          <input ref={nameInput} required maxLength={200} value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded border border-line bg-transparent p-2.5 text-base" />
        </label>
        <p className="text-sm text-ink-2">Save all project tasks, including completed tasks, with their notes and subtasks. New projects start incomplete, without old dates or reminders. Your original project stays as it is.</p>
        {error && <p role="alert" className="text-sm text-accent">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="min-h-11 rounded bg-ink px-4 py-2 text-sm text-bg disabled:opacity-50">{pending ? 'Saving…' : 'Save template'}</button>
          <button type="button" className="min-h-11 rounded border border-line px-4 py-2 text-sm" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </fieldset>
    </form>}
    {children}
  </DetailSection>;
}
