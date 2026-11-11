'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { TaskTemplate, TaskTemplateEntry } from '@jevi-ops/shared';
import { listTaskTemplates, loadProjectSnapshot, loadTaskTemplate, saveProjectAsTemplate, saveTaskTemplate } from '../../task-templates/actions';
import { diffSnapshot, mergeSnapshot, normalizeTitle, type SnapshotDiff } from '../../task-templates/merge-snapshot';

const MAX_TASKS = 200;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const inputClass = 'mt-1 block w-full rounded border border-line bg-transparent p-2.5 text-base text-ink focus:outline-accent';

interface Loaded {
  templates: TaskTemplate[];
  edited: Record<string, string>;
  /** The project's tasks as template entries, or null with the reason they could not be read. */
  snapshot: TaskTemplateEntry[] | null;
  snapshotError: string;
}

// "Save as template" for a project: as a new template, or as an update to an
// existing one. Nothing links a project to the template it came from, so an
// update is previewed as added / removed / unchanged by title, and each added
// or removed task can be left out of the change (a trip's one-off items do
// not belong in the reusable list).
export function SaveTemplatePanel({ projectId, projectName, onCancel, onSaved }: {
  projectId: string;
  projectName: string;
  onCancel: () => void;
  onSaved: (saved: { id: string; message: string }) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mode, setMode] = useState<'new' | 'update'>('new');
  const [name, setName] = useState(projectName);
  const [targetId, setTargetId] = useState('');
  // Unticked boxes: project tasks not to add, and template entries to keep.
  const [skipAdded, setSkipAdded] = useState<ReadonlySet<string>>(() => new Set());
  const [keepRemoved, setKeepRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const submitting = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const targetSelect = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [list, snapshot] = await Promise.all([
        listTaskTemplates().catch(() => null),
        loadProjectSnapshot(projectId).catch(() => null),
      ]);
      if (!live) return;
      // Templates are optional: if they cannot be listed, saving as new still works.
      const templates = list?.ok ? list.value.templates : [];
      // A template already carrying this project's name is the likely target;
      // defaulting to "new" there is how duplicates get made.
      const same = templates.find(template => normalizeTitle(template.name) === normalizeTitle(projectName));
      setMode(same ? 'update' : 'new');
      setTargetId((same ?? templates[0])?.id ?? '');
      setLoaded({
        templates, edited: list?.ok ? list.value.edited : {},
        snapshot: snapshot?.ok ? snapshot.value : null,
        snapshotError: snapshot?.ok ? '' : snapshot?.error ?? 'Could not read this project’s tasks. Please try again.',
      });
    })();
    return () => { live = false; };
  }, [projectId, projectName]);
  const ready = loaded !== null;
  // Once, when the panel is ready: put the cursor where the first decision is.
  useEffect(() => {
    if (!ready) return;
    if (targetSelect.current) targetSelect.current.focus();
    else { nameInput.current?.focus(); nameInput.current?.select(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const templates = loaded?.templates ?? [];
  const snapshot = loaded?.snapshot ?? null;
  const target = templates.find(template => template.id === targetId);
  const updating = mode === 'update' && Boolean(target);
  const diff = target && snapshot ? diffSnapshot(target.entries, snapshot) : null;
  // Mostly different: the per-task lists would be noise, so the update is all or nothing.
  const poorMatch = Boolean(diff && target && diff.unchanged < target.entries.length / 2);
  const merged = target && snapshot ? mergeSnapshot(target.entries, snapshot, poorMatch ? {} : { skipAdded, keepRemoved }) : [];
  const chooseTarget = (id: string) => { setTargetId(id); setSkipAdded(new Set()); setKeepRemoved(new Set()); setError(''); setNotice(''); };
  const toggle = (set: ReadonlySet<string>, key: string) => { const next = new Set(set); if (!next.delete(key)) next.add(key); return next; };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !loaded || !snapshot) return;
    if (updating && merged.length > MAX_TASKS) {
      setError(`The updated template would have ${merged.length} tasks. Templates hold up to ${MAX_TASKS}; leave some out, or save a new template.`);
      return;
    }
    submitting.current = true; setPending(true); setError(''); setNotice('');
    try {
      if (!updating || !target) {
        const result = await saveProjectAsTemplate({ project_id: projectId, name });
        if (result.ok) onSaved({ id: result.value.id, message: `Saved “${result.value.name}”.` });
        else setError(result.error);
        return;
      }
      const result = await saveTaskTemplate({ id: target.id, revision: target.revision, name: target.name, entries: merged });
      if (result.ok) { onSaved({ id: result.value.id, message: `Updated “${result.value.name}” to ${plural(result.value.entries.length, 'task')}.` }); return; }
      if (result.currentRevision === undefined) { setError(result.error); return; }
      // Saved elsewhere since this panel read it. Fetch that version and show
      // the summary again; choices still apply wherever the titles still do.
      const fresh = await loadTaskTemplate(target.id);
      if (fresh.ok) {
        setLoaded({ ...loaded, templates: templates.map(template => template.id === fresh.value.id ? fresh.value : template) });
        setKeepRemoved(previous => new Set([...previous].filter(key => fresh.value.entries.some(entry => entry.key === key))));
        setNotice(`“${fresh.value.name}” was changed in another window. The summary below is up to date; check it and update again.`);
      } else {
        const remaining = templates.filter(template => template.id !== target.id);
        setLoaded({ ...loaded, templates: remaining });
        setTargetId(remaining[0]?.id ?? '');
        if (!remaining.length) setMode('new');
        setError('That template is no longer available. Choose another, or save a new template.');
      }
    } catch { setError('Could not save the template. Please try again.'); }
    finally { submitting.current = false; setPending(false); }
  }

  if (!loaded) return <p role="status" className="mb-4 rounded border border-line p-4 text-sm text-ink-3">Reading this project’s tasks…</p>;
  const blocked = loaded.snapshotError;
  return <form onSubmit={submit} className="mb-4 rounded border border-line p-4">
    <fieldset disabled={pending} className="space-y-3">
      {templates.length > 0 && <label className="-my-1 flex min-h-11 items-center gap-2.5 text-sm">
        <input type="radio" name="save-template-mode" className="accent-ink" checked={mode === 'new'} onChange={() => { setMode('new'); setError(''); setNotice(''); }} />
        Save as a new template
      </label>}
      {mode === 'new' && <label className="block text-sm">Template name
        <input ref={nameInput} required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={inputClass} />
      </label>}
      {templates.length > 0 && <label className="-my-1 flex min-h-11 items-center gap-2.5 text-sm">
        <input type="radio" name="save-template-mode" className="accent-ink" checked={mode === 'update'} onChange={() => { setMode('update'); setError(''); setNotice(''); }} />
        Update an existing template
      </label>}
      {updating && target && <>
        <label className="block text-sm">Template to update
          <select ref={targetSelect} value={targetId} onChange={e => chooseTarget(e.target.value)} className={inputClass}>
            {templates.map(template => <option key={template.id} value={template.id}>
              {template.name} · {plural(template.entries.length, 'task')}{loaded.edited[template.id] ? ` · edited ${loaded.edited[template.id]}` : ''}
            </option>)}
          </select>
        </label>
        {notice && <p role="status" className="text-sm text-ink">{notice}</p>}
        {diff && snapshot && <ChangeSummary diff={diff} poorMatch={poorMatch} templateName={target.name} projectTasks={snapshot.length}
          skipAdded={skipAdded} keepRemoved={keepRemoved}
          onToggleAdded={key => setSkipAdded(current => toggle(current, key))} onToggleRemoved={key => setKeepRemoved(current => toggle(current, key))} />}
      </>}
      <p className="text-sm text-ink-2">
        {updating ? 'This project stays as it is. Projects already made from the template keep their own tasks.'
          : 'Saves every task, including completed ones, with notes and subtasks. New projects start incomplete, without old dates or reminders. This project stays as it is.'}
      </p>
      {(error || blocked) && <p role="alert" className="text-sm text-accent">{error || blocked}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={Boolean(blocked)} className="min-h-11 rounded bg-ink px-4 py-2 text-sm text-bg disabled:opacity-50">
          {pending ? 'Saving…' : updating ? `Update template · ${plural(merged.length, 'task')}` : `Save new template${snapshot ? ` · ${plural(snapshot.length, 'task')}` : ''}`}
        </button>
        <button type="button" className="min-h-11 rounded border border-line px-4 py-2 text-sm" onClick={onCancel}>Cancel</button>
      </div>
    </fieldset>
  </form>;
}

function ChangeSummary({ diff, poorMatch, templateName, projectTasks, skipAdded, keepRemoved, onToggleAdded, onToggleRemoved }: {
  diff: SnapshotDiff; poorMatch: boolean; templateName: string; projectTasks: number;
  skipAdded: ReadonlySet<string>; keepRemoved: ReadonlySet<string>;
  onToggleAdded: (key: string) => void; onToggleRemoved: (key: string) => void;
}) {
  if (poorMatch) return <p className="rounded border border-warn-line bg-warn-soft p-3 text-sm text-ink">
    {diff.unchanged === 0 ? 'None' : `Only ${diff.unchanged}`} of this project’s {plural(projectTasks, 'task')} {diff.unchanged === 1 ? 'is' : 'are'} in “{templateName}”.
    {' '}Updating would add {diff.added.length} and remove {diff.removed.length}. This looks like a different list; consider saving a new template.
  </p>;
  return <div className="space-y-3 rounded border border-line p-3">
    <CheckList legend={`Add to template · ${diff.added.length}`} tone="text-good" entries={diff.added} checked={key => !skipAdded.has(key)} onToggle={onToggleAdded} />
    <CheckList legend={`Remove from template · ${diff.removed.length}`} tone="text-accent" entries={diff.removed} checked={key => !keepRemoved.has(key)} onToggle={onToggleRemoved} />
    <p className="text-sm text-ink-2">
      {plural(diff.unchanged, 'task')} unchanged
      {!diff.added.length && !diff.removed.length && '. Nothing to add or remove; updating only matches the template’s order to this project.'}
    </p>
  </div>;
}

function CheckList({ legend, tone, entries, checked, onToggle }: {
  legend: string; tone: string; entries: TaskTemplateEntry[]; checked: (key: string) => boolean; onToggle: (key: string) => void;
}) {
  if (!entries.length) return null;
  return <fieldset>
    <legend className={`font-mono text-[10px] uppercase tracking-[0.09em] ${tone}`}>{legend}</legend>
    <ul className="mt-1 max-h-64 overflow-y-auto">
      {entries.map(entry => <li key={entry.key}>
        <label className="flex min-h-11 items-center gap-2.5 text-sm text-ink">
          <input type="checkbox" className="accent-ink" checked={checked(entry.key)} onChange={() => onToggle(entry.key)} />
          <span className="min-w-0 break-words">{entry.title}</span>
        </label>
      </li>)}
    </ul>
  </fieldset>;
}
