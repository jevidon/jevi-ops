'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClientId } from '@/lib/client-id';
import { useToast } from '@/components/toast/ToastProvider';
import type { TaskTemplate, TaskTemplateEntry } from '@jevi-ops/shared';
import { loadTaskTemplate, saveTaskTemplate, type ActionFailure } from './actions';
import {
  append, blankRow, canIndent, canOutdent, hasChildren, indent, insertAfter, insertPasted, MAX_ROWS, moveDown, moveUp, nextSibling, outdent,
  parsePaste, previousSibling, remove, toEntries, toRows, type OutlineRow,
} from './outline';
import { entryField, templateSummary, UNTITLED_NOTE_ERROR, UNTITLED_NOTE_FIELD_ERROR } from './template-draft';
import { buttonClass, failed, field, FieldError, primaryClass } from './ui';
import { useLeaveGuard } from './use-leave-guard';

const LIBRARY = '/task-templates';
const LIMIT_REACHED = `Templates hold up to ${MAX_ROWS} tasks. Remove one to add another.`;
const snapshot = (name: string, rows: OutlineRow[]) => JSON.stringify([name, rows]);
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const toolClass = 'inline-flex min-h-9 min-w-9 items-center justify-center rounded border border-line px-2.5 font-mono text-[11px] text-ink-2 hover:border-ink-3 hover:text-ink disabled:opacity-35 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';
type Tool = 'outdent' | 'indent' | 'up' | 'down' | 'note' | 'remove';

// The editor page for one template: a name and an outline. One line per task,
// indentation for subtasks (see outline.ts for the rules). `template` is the
// stored record being edited; without it this creates a new one, optionally
// prefilled from `initial` (Duplicate). A prefilled draft is not "unsaved
// changes": nothing the user typed is lost by leaving it.
export function TemplateEditor({ template, initial }: {
  template?: TaskTemplate;
  initial?: { name: string; entries: TaskTemplateEntry[] };
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(template?.name ?? initial?.name ?? '');
  const [rows, setRows] = useState<OutlineRow[]>(() => {
    const loaded = toRows(template?.entries ?? initial?.entries ?? []);
    return loaded.length ? loaded : [blankRow(createClientId())];
  });
  const [revision, setRevision] = useState(template?.revision);
  const [baseline, setBaseline] = useState(() => snapshot(name, rows));
  const [openNotes, setOpenNotes] = useState<ReadonlySet<string>>(() => new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Roving tab stop: one row is in the page's Tab order (the last one focused,
  // or the first). Arrow keys move between rows. Without this, releasing Tab
  // with Esc would only walk into the next row and be captured again.
  const [homeKey, setHomeKey] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // Esc hands Tab back to the browser until the next edit or row change, so
  // the list is never a keyboard trap.
  const tabReleased = useRef(false);
  // Where focus belongs after the next render: a row's title (with a caret),
  // its note, or the tool that was just pressed.
  const focusNext = useRef<{ key: string; target?: Tool | 'notes'; caret?: number | null } | null>(null);
  const dirty = snapshot(name, rows) !== baseline;
  const guard = useLeaveGuard(dirty, LIBRARY);

  const rowOf = (key: string) => [...(list.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])].find(element => element.dataset.row === key) ?? null;
  const titleOf = (key: string) => rowOf(key)?.querySelector<HTMLInputElement>('[data-title]') ?? null;
  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    const row = rowOf(next.key);
    if (!row) return;
    const tool = next.target && next.target !== 'notes' ? row.querySelector<HTMLButtonElement>(`[data-tool="${next.target}"]:not(:disabled)`) : null;
    const element = tool ?? (next.target === 'notes' ? row.querySelector<HTMLTextAreaElement>('textarea') : null) ?? row.querySelector<HTMLInputElement>('[data-title]');
    element?.focus();
    if (element instanceof HTMLInputElement && typeof next.caret === 'number') element.setSelectionRange(next.caret, next.caret);
  }, [rows, openNotes]);
  // A failed save moves focus to the first marked field, which also scrolls
  // it into view on a long template. Runs once per failure, not on later edits.
  useEffect(() => {
    const fields = error?.fieldErrors;
    if (!fields) return;
    if (fields.name) { nameInput.current?.focus(); return; }
    const marked = rows.find(row => fields[entryField(row.key)]);
    if (marked) titleOf(marked.key)?.focus();
    else if (fields.entries) (titleOf(rows[0]?.key ?? '') ?? addButton.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  // Local validation keeps an unresolved conflict's revision, so the conflict
  // choices stay on screen while the marked field is fixed.
  const invalid = (message: string, fieldErrors: Record<string, string>) =>
    setError(previous => ({ ...failed(message), fieldErrors, currentRevision: previous?.currentRevision }));

  const patchRow = (key: string, patch: Partial<OutlineRow>) => {
    tabReleased.current = false;
    setNotice('');
    setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  };
  /** Apply a structural change and say where focus goes afterwards. */
  function change(next: OutlineRow[], focus: { key: string; target?: Tool | 'notes'; caret?: number | null }) {
    if (next === rows) return;
    tabReleased.current = false;
    setNotice('');
    focusNext.current = focus;
    setRows(next);
  }
  function addAfter(index: number) {
    if (rows.length >= MAX_ROWS) { setNotice(LIMIT_REACHED); return; }
    const key = createClientId();
    change(insertAfter(rows, index, key), { key, caret: 0 });
  }
  function removeAt(index: number) {
    const next = remove(rows, index, createClientId);
    const landing = next[Math.max(0, index - 1)]!;
    change(next, { key: landing.key, caret: landing.title.length });
  }
  function toggleNote(key: string) {
    const opening = !openNotes.has(key);
    focusNext.current = { key, target: opening ? 'notes' : undefined };
    setOpenNotes(current => { const next = new Set(current); if (opening) next.add(key); else next.delete(key); return next; });
  }
  /** One implementation for the row tools and their keyboard shortcuts. */
  function run(tool: Tool, index: number, from: 'key' | 'button', caret?: number | null) {
    const row = rows[index];
    if (!row) return;
    const focus = from === 'button' ? { key: row.key, target: tool } : { key: row.key, caret };
    if (tool === 'indent') change(indent(rows, index), focus);
    else if (tool === 'outdent') change(outdent(rows, index), focus);
    else if (tool === 'up') change(moveUp(rows, index), focus);
    else if (tool === 'down') change(moveDown(rows, index), focus);
    else if (tool === 'note') toggleNote(row.key);
    else removeAt(index);
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.nativeEvent.isComposing) return;
    const row = rows[index]!;
    const caret = event.currentTarget.selectionStart;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
    if (event.key === 'Escape') {
      tabReleased.current = true;
      setNotice('Tab now leaves the list.');
    } else if (event.key === 'Enter' && plain) {
      event.preventDefault();
      addAfter(index);
    } else if (event.key === 'Tab' && plain) {
      if (tabReleased.current) return;
      // Always taken while armed, so Tab never sometimes indents and sometimes leaves.
      event.preventDefault();
      run(event.shiftKey ? 'outdent' : 'indent', index, 'key', caret);
    } else if (event.key === 'Backspace' && plain && !row.title && !row.notes && rows.length > 1) {
      event.preventDefault();
      removeAt(index);
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      run(event.key === 'ArrowUp' ? 'up' : 'down', index, 'key', caret);
    } else if (plain && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const target = rows[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (!target) return;
      event.preventDefault();
      titleOf(target.key)?.focus();
    }
  }
  function onTitlePaste(event: ClipboardEvent<HTMLInputElement>, index: number) {
    const lines = parsePaste(event.clipboardData.getData('text'));
    if (!lines) return;
    event.preventDefault();
    const pasted = insertPasted(rows, index, lines, createClientId);
    if (!pasted) { setNotice(`That paste would make ${plural(lines.length, 'more task')}. Templates hold up to ${MAX_ROWS}, so nothing was added.`); return; }
    change(pasted.rows, { key: pasted.lastKey, caret: lines[lines.length - 1]!.title.length });
  }
  function onListFocus(event: FocusEvent<HTMLDivElement>) {
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.row ?? null;
    if (key && key !== activeKey) { tabReleased.current = false; setActiveKey(key); setHomeKey(key); }
  }
  function onListBlur(event: FocusEvent<HTMLDivElement>) {
    // Row tools show for the focused row only; hide them when focus leaves the list.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveKey(null);
  }

  async function save(expectedRevision = revision) {
    if (submitting.current) return;
    // A note with no title would be dropped along with the blank rows.
    const orphaned = rows.filter(row => !row.title.trim() && row.notes?.trim());
    if (orphaned.length) { invalid(UNTITLED_NOTE_ERROR, Object.fromEntries(orphaned.map(row => [entryField(row.key), UNTITLED_NOTE_FIELD_ERROR]))); return; }
    const entries = toEntries(rows);
    if (!entries.length) { invalid('Add at least one task.', { entries: 'Add at least one task.' }); return; }
    submitting.current = true; setPending(true); setError(null);
    try {
      const result = await saveTaskTemplate({ id: template?.id, revision: expectedRevision, name, entries });
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
        const loaded = toRows(result.value.entries);
        setName(result.value.name); setRows(loaded); setRevision(result.value.revision); setError(null); setOpenNotes(new Set());
        // The loaded version is the new clean state, so the guard stands down.
        setBaseline(snapshot(result.value.name, loaded));
      } else setError(previous => ({ ...result, currentRevision: previous?.currentRevision }));
    } catch { setError(previous => ({ ...failed('Could not load the saved version. Your edits are still here.'), currentRevision: previous?.currentRevision })); }
    finally { submitting.current = false; setPending(false); }
  }

  const conflict = error?.currentRevision !== undefined;
  const tabStop = rows.some(row => row.key === homeKey) ? homeKey : rows[0]?.key;
  const summary = templateSummary(toEntries(rows));
  return <form onSubmit={event => { event.preventDefault(); if (!conflict) void save(); }} className="max-w-2xl">
    <fieldset disabled={pending} className="space-y-5">
      <label className="block text-sm">Template name
        <input ref={nameInput} autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={field(error?.fieldErrors?.name)} placeholder="Packing for a flight" aria-invalid={Boolean(error?.fieldErrors?.name)} aria-describedby={error?.fieldErrors?.name ? 'template-name-error' : undefined} />
      </label>
      <FieldError id="template-name-error" message={error?.fieldErrors?.name} />
      <div>
        <h2 className="text-sm font-semibold">Tasks</h2>
        <p id="template-outline-hint" className="mt-1 text-sm text-ink-3">
          <span className="hidden lg:inline">Enter adds a task. Tab and Shift+Tab make and unmake a subtask. Alt+↑ and Alt+↓ move a task. Esc, then Tab, leaves the list. </span>
          <span className="lg:hidden">Select a task for its tools. </span>
          Paste several lines to add them all at once.
        </p>
        <FieldError id="template-entries-error" message={error?.fieldErrors?.entries} />
        <div ref={list} role="group" aria-label="Tasks in this template" aria-describedby="template-outline-hint" onFocus={onListFocus} onBlur={onListBlur} className="mt-3 border-t border-line">
          {rows.map((row, index) => {
            const parent = hasChildren(rows, index);
            const noteOpen = openNotes.has(row.key);
            const rowError = error?.fieldErrors?.[entryField(row.key)];
            const rowErrorId = `template-task-error-${row.key}`;
            const label = `Task ${index + 1}`;
            const tabIndex = row.key === tabStop ? 0 : -1;
            return <div key={row.key} data-row={row.key} className={`border-b ${rowError ? 'border-accent' : 'border-line'} ${activeKey === row.key ? 'bg-ink/[0.03]' : ''}`} style={{ '--indent': `${Math.min(row.depth, 4) * 1.5}rem`, paddingLeft: 'var(--indent)' } as CSSProperties}>
              <div className="flex items-center gap-2.5">
                <span aria-hidden className={`ml-1 shrink-0 rounded-[1px] ${parent ? 'h-[7px] w-[7px] bg-ink' : 'h-1.5 w-1.5 bg-ink-4'}`} />
                <input data-title tabIndex={tabIndex} aria-label={row.depth === 0 ? label : row.depth === 1 ? `${label}, subtask` : `${label}, level ${row.depth + 1}`}
                  maxLength={500} autoComplete="off" enterKeyHint="next" placeholder="Task" value={row.title}
                  onChange={e => patchRow(row.key, { title: e.target.value })} onKeyDown={e => onTitleKeyDown(e, index)} onPaste={e => onTitlePaste(e, index)}
                  aria-invalid={Boolean(rowError)} aria-describedby={rowError ? rowErrorId : undefined}
                  className={`min-w-0 flex-1 bg-transparent py-2.5 text-base text-ink outline-none placeholder:text-ink-3 ${parent ? 'font-medium' : ''}`} />
                {row.notes && !noteOpen && <button type="button" tabIndex={tabIndex} aria-label={`Show note for task ${index + 1}`} onClick={() => toggleNote(row.key)}
                  className="mr-1 shrink-0 rounded-[3px] border border-line-strong px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.07em] text-ink-2 hover:border-ink-3">note</button>}
              </div>
              {rowError && <div className="pb-2 pl-5"><FieldError id={rowErrorId} message={rowError} /></div>}
              {row.depth > 1 && <p className="pb-2 pl-5 text-sm text-ink-3">Project pages show one level of subtasks, so this task will not appear. Outdent it to keep it visible.</p>}
              {noteOpen && <textarea tabIndex={tabIndex} aria-label={`Note for task ${index + 1}`} rows={2} maxLength={200_000} placeholder="Note" value={row.notes ?? ''}
                onChange={e => patchRow(row.key, { notes: e.target.value || null })}
                className="mb-2.5 ml-5 block w-[calc(100%-1.5rem)] rounded border border-line bg-transparent p-2 text-sm text-ink focus:outline-accent" />}
              {/* On a phone the tools take the full row width, ignoring the
                  subtask indent, so all six fit on one line. */}
              {activeKey === row.key && <div role="toolbar" aria-label={`Task ${index + 1} tools`} className="ml-[calc(var(--indent)*-1)] flex flex-wrap gap-1.5 pb-2.5 pl-1 pr-1 lg:ml-0 lg:pl-5">
                <button type="button" data-tool="outdent" className={toolClass} aria-label={`Outdent task ${index + 1}`} disabled={!canOutdent(rows, index)} onClick={() => run('outdent', index, 'button')}>←</button>
                <button type="button" data-tool="indent" className={toolClass} aria-label={`Indent task ${index + 1}`} disabled={!canIndent(rows, index)} onClick={() => run('indent', index, 'button')}>→</button>
                <button type="button" data-tool="up" className={toolClass} aria-label={`Move task ${index + 1} up`} disabled={previousSibling(rows, index) < 0} onClick={() => run('up', index, 'button')}>↑</button>
                <button type="button" data-tool="down" className={toolClass} aria-label={`Move task ${index + 1} down`} disabled={nextSibling(rows, index) < 0} onClick={() => run('down', index, 'button')}>↓</button>
                <button type="button" data-tool="note" className={toolClass} aria-expanded={noteOpen} onClick={() => run('note', index, 'button')}>{noteOpen ? 'Hide note' : row.notes ? 'Note' : '+ Note'}</button>
                <button type="button" data-tool="remove" className={`${toolClass} ml-auto text-accent`} aria-label={`Remove task ${index + 1}`} onClick={() => run('remove', index, 'button')}>Remove</button>
              </div>}
            </div>;
          })}
        </div>
        <button ref={addButton} type="button" className={`${buttonClass} mt-3`} onClick={() => {
          if (rows.length >= MAX_ROWS) { setNotice(LIMIT_REACHED); return; }
          const key = createClientId();
          change(append(rows, key), { key, caret: 0 });
        }}>+ Task</button>
        {notice && <p role="status" className="mt-3 text-sm text-ink-2">{notice}</p>}
      </div>
      <p className="text-sm text-ink-2">Changes apply to future projects. Existing projects keep their own tasks and progress.</p>
      {/* Sticky action bar: state on the left, actions on the right. On a
          phone it rides above the tab bar, and the extra bottom padding keeps
          its buttons clear of the raised capture button. */}
      <div className="sticky bottom-[calc(59px+env(safe-area-inset-bottom))] z-10 -mx-5 border-t border-line-strong bg-bg px-5 pb-6 pt-3 lg:bottom-0 lg:mx-0 lg:px-0 lg:pb-4">
        {error && <p role="alert" className="mb-3 text-sm text-accent">{error.error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="font-mono text-[11px] text-ink-3" aria-live="polite">
            {plural(summary.tasks, 'task')}{summary.groups ? ` · ${plural(summary.groups, 'group')}` : ''}{rows.length >= MAX_ROWS - 20 ? ` · of ${MAX_ROWS}` : ''}
            {dirty && <span className="text-ink"> · Unsaved changes</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {/* A link, so the leave guard asks before discarding a dirty draft. */}
            <Link href={LIBRARY} className={buttonClass}>Cancel</Link>
            {conflict ? <>
              <button className={buttonClass} type="button" onClick={discardAndLoad}>Discard mine, load saved version</button>
              <button className={primaryClass} type="button" onClick={() => save(error!.currentRevision)}>{pending ? 'Working…' : 'Save mine over it'}</button>
            </> : <button className={primaryClass} type="submit">{pending ? 'Saving…' : 'Save template'}</button>}
          </div>
        </div>
      </div>
    </fieldset>
    {guard.dialog}
  </form>;
}
