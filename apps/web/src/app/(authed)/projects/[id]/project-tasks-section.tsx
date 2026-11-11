'use client';

import Link from 'next/link';
import { DetailSection } from '@/components/detail/DetailShell';
import { useState, type ReactNode } from 'react';
import { SaveTemplatePanel } from './save-template-panel';

// The project page's Tasks section. It owns the section header because the
// header's "Save as template" action and the panel it opens share state; the
// page passes the section body (status settings, quick add, task list) as
// children.
export function ProjectTasksSection({ projectId, projectName, count, children }: { projectId: string; projectName: string; count?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ id: string; message: string } | null>(null);

  // The trigger keeps the header's quiet 10px mono style; the ::after box
  // widens its hit area to about 44px without changing the header's layout.
  return <DetailSection label="Tasks" count={count} action={
    <button type="button" disabled={open} className="relative font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3 hover:text-ink transition-colors disabled:opacity-50 after:absolute after:inset-x-[-8px] after:inset-y-[-15px] after:content-['']" onClick={() => { setSaved(null); setOpen(true); }}>Save as template</button>
  }>
    {saved && <p role="status" className="mb-4 text-sm text-ink-2">{saved.message} Your project is unchanged. <Link className="text-accent underline" href={`/task-templates/${saved.id}`}>Open template</Link></p>}
    {/* Mounted fresh each time, so it re-reads the templates and this project's tasks. */}
    {open && <SaveTemplatePanel projectId={projectId} projectName={projectName} onCancel={() => setOpen(false)}
      onSaved={result => { setSaved(result); setOpen(false); }} />}
    {children}
  </DetailSection>;
}
