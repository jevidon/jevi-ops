'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { TaskTemplate } from '@jevi-ops/shared';
import { deleteTaskTemplate } from './actions';
import { templateSummary } from './template-draft';
import { buttonClass } from './ui';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

// The library list. Each template is a row that can be read without opening
// it: the name opens the editor, Use opens the New project form with this
// template chosen, and the row menu holds the rest. `edited` carries each
// template's edit date, already formatted in the app timezone by the server
// page. `domainId` rides along to the New project form when the library was
// opened from a domain.
export function TemplateLibrary({ initialTemplates, edited, domainId = '' }: {
  initialTemplates: TaskTemplate[];
  edited: Record<string, string>;
  domainId?: string;
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  // The server list is the source of truth after a save or a refresh; local
  // state only runs ahead of it for a delete.
  useEffect(() => setTemplates(initialTemplates), [initialTemplates]);
  const [notice, setNotice] = useState('');

  return <div className="max-w-3xl">
    {notice && <p role="status" className="mb-4 text-sm text-ink-2">{notice}</p>}
    {!templates.length ? <p className="text-ink-3">No templates yet. Choose + Template to write one, or open any project and choose Save as template in its Tasks section.</p> :
      <ul className="divide-y divide-line border-y border-line">
        {templates.map(template => <TemplateRow key={template.id} template={template} edited={edited[template.id]}
          useHref={`/projects/new?template_id=${template.id}${domainId ? `&domain_id=${encodeURIComponent(domainId)}` : ''}`}
          onDeleted={() => { setTemplates(current => current.filter(t => t.id !== template.id)); setNotice(`Deleted “${template.name}”. Existing projects are unchanged.`); }} />)}
      </ul>}
  </div>;
}

function TemplateRow({ template, edited, useHref, onDeleted }: { template: TaskTemplate; edited?: string; useHref: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const deleting = useRef(false);
  const questionId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  // Opening the confirmation unmounts the row's actions. Move focus to Cancel
  // (the safe choice), and back to the row menu when the panel closes.
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
    else if (wasConfirming.current) menuButton.current?.focus();
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
  const summary = templateSummary(template.entries);
  const meta = [plural(summary.tasks, 'task'), summary.groups ? plural(summary.groups, 'group') : '', edited ? `edited ${edited}` : ''].filter(Boolean).join(' · ');
  const editHref = `/task-templates/${template.id}`;
  return <li className="py-5">
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-56">
        <h2 className="font-serif text-2xl break-words">
          <Link href={editHref} className="underline decoration-line-strong underline-offset-4 hover:decoration-ink">{template.name}</Link>
        </h2>
        <p className="mt-1.5 font-mono text-[11px] text-ink-3">{meta}</p>
        {summary.peek && <p className="mt-1 text-sm text-ink-2 break-words">{summary.peek}</p>}
      </div>
      {!confirming && <div className="flex items-center gap-2">
        <Link href={useHref} className={buttonClass} aria-label={`Use ${template.name}`}>Use</Link>
        <RowMenu name={template.name} button={menuButton} editHref={editHref} duplicateHref={`/task-templates/new?from=${template.id}`} onDelete={() => setConfirming(true)} />
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

const itemClass = 'flex min-h-11 w-full items-center px-4 text-left text-sm text-ink hover:bg-surface-2 focus:bg-surface-2 focus:outline-none';

// Row overflow menu (WAI-ARIA menu button). Arrow keys move between items,
// Escape closes and returns focus to the button, and a click outside closes.
function RowMenu({ name, button, editHref, duplicateHref, onDelete }: {
  name: string; button: RefObject<HTMLButtonElement | null>; editHref: string; duplicateHref: string; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  // The row's actions sit at the right on desktop and wrap to the left on a
  // phone, so the menu opens toward whichever side has room.
  const [side, setSide] = useState<'left' | 'right'>('right');
  const root = useRef<HTMLDivElement>(null);
  const toggle = () => {
    const box = button.current?.getBoundingClientRect();
    if (box) setSide(box.left + box.width / 2 < window.innerWidth / 2 ? 'left' : 'right');
    setOpen(current => !current);
  };
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function onKeyDown(event: KeyboardEvent) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const focus = (index: number) => { event.preventDefault(); list[(index + list.length) % list.length]?.focus(); };
    if (event.key === 'ArrowDown') focus(at + 1);
    else if (event.key === 'ArrowUp') focus(at - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(list.length - 1);
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); }
    else if (event.key === 'Tab') setOpen(false);
  }
  return <div ref={root} className="relative">
    <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${name}`}
      className={`${buttonClass} px-3`} onClick={toggle}>
      <span aria-hidden className="font-mono tracking-widest">···</span>
    </button>
    {open && <div role="menu" aria-label={`Actions for ${name}`} onKeyDown={onKeyDown}
      className={`absolute ${side === 'left' ? 'left-0' : 'right-0'} z-20 mt-1 min-w-40 rounded border border-line-strong bg-surface py-1 shadow-lg`}>
      <Link role="menuitem" href={editHref} className={itemClass}>Edit</Link>
      <Link role="menuitem" href={duplicateHref} className={itemClass}>Duplicate</Link>
      <button role="menuitem" type="button" className={`${itemClass} text-accent`} onClick={() => { setOpen(false); onDelete(); }}>Delete…</button>
    </div>}
  </div>;
}
