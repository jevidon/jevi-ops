import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateEditor } from './template-editor';

const { save, load, replace, refresh, toast } = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn(), replace: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock('./actions', () => ({ saveTaskTemplate: save, loadTaskTemplate: load }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/components/toast/ToastProvider', () => ({ useToast: () => toast }));
const template = { id: 'template-1', name: 'Packing', entries: [{ key: 'parent', title: 'Passport', notes: 'Check expiry', parent_key: null }, { key: 'child', title: 'Charger', notes: 'USB-C', parent_key: 'parent' }], revision: 2, created_at: '', updated_at: '' };
const flat = { ...template, entries: ['Passport', 'Charger', 'Keys'].map(title => ({ key: title.toLowerCase(), title, notes: null, parent_key: null })) };
// jsdom cannot navigate: swallow link clicks the leave guard lets through.
const swallow = (event: Event) => { if ((event.target as Element).closest('a')) event.preventDefault(); };
const leaving = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); document.removeEventListener('click', swallow); });
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState(null, '', '/task-templates/template-1'); document.addEventListener('click', swallow); });

// Title inputs are labelled "Task N" (main) or "Task N, subtask".
const task = (n: number) => screen.getByRole('textbox', { name: new RegExp(`^Task ${n}(,|$)`) }) as HTMLInputElement;
const titles = () => screen.getAllByRole('textbox', { name: /^Task \d+/ }).map(input => `${input.getAttribute('aria-label')!.includes('subtask') ? '  ' : ''}${(input as HTMLInputElement).value}`);
const saved = (call = 0) => save.mock.calls[call]![0];
const saveButton = () => screen.getByRole('button', { name: 'Save template' });

describe('the outline', () => {
  it('shows one line per task with subtasks indented under their parent', () => {
    render(<TemplateEditor template={template} />);
    expect(titles()).toEqual(['Passport', '  Charger']);
    expect(task(2).getAttribute('aria-label')).toBe('Task 2, subtask');
    // Tools belong to the focused row only.
    expect(screen.queryByRole('toolbar')).toBeNull();
    // A task with a note carries a marker until its note is opened.
    expect(screen.getByRole('button', { name: 'Show note for task 1' })).toBeTruthy();
  });

  it('builds a list from the keyboard: Enter adds a task, Tab makes it a subtask', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: true, value: template });
    render(<TemplateEditor />);
    await user.type(screen.getByLabelText('Template name'), 'Packing');
    await user.type(task(1), 'Documents{Enter}');
    expect(document.activeElement).toBe(task(2));
    await user.keyboard('Passport{Tab}');
    expect(document.activeElement).toBe(task(2));
    expect(task(2).getAttribute('aria-label')).toBe('Task 2, subtask');
    // Enter under a subtask continues at the same level; Shift+Tab steps back out.
    await user.keyboard('{Enter}Boarding pass{Enter}Keys{Shift>}{Tab}{/Shift}');
    expect(titles()).toEqual(['Documents', '  Passport', '  Boarding pass', 'Keys']);
    await user.click(saveButton());
    const [documents, passport, boarding, keys] = saved().entries;
    expect(saved()).toMatchObject({ id: undefined, revision: undefined, name: 'Packing' });
    expect([documents, passport, boarding, keys].map(e => [e.title, e.parent_key])).toEqual([
      ['Documents', null], ['Passport', documents.key], ['Boarding pass', documents.key], ['Keys', null],
    ]);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/task-templates'));
    expect(refresh).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith({ message: 'Saved “Packing”. Existing projects keep their tasks and progress.' });
    // The save was a decision to leave: the guard does not ask about it.
    expect(leaving()).toBe(false);
  });

  it('adds under a parent as its first subtask, and Backspace removes an empty line', async () => {
    const user = userEvent.setup();
    render(<TemplateEditor template={template} />);
    await user.click(task(1));
    await user.keyboard('{Enter}');
    expect(titles()).toEqual(['Passport', '  ', '  Charger']);
    expect(document.activeElement).toBe(task(2));
    await user.keyboard('{Backspace}');
    expect(titles()).toEqual(['Passport', '  Charger']);
    expect(document.activeElement).toBe(task(1));
    // Backspace in a line that still has text only edits the text.
    await user.keyboard('{Backspace}');
    expect(titles()).toEqual(['Passpor', '  Charger']);
  });

  it('keeps Tab inside the list until Esc releases it, then leaves through the row tools', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TemplateEditor template={flat} />);
    await user.click(task(2));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('status').textContent).toBe('Tab now leaves the list.');
    expect(titles()).toEqual(['Passport', 'Charger', 'Keys']);
    // Released: Tab walks this row's tools, then leaves the list. It never lands
    // in another row, which would capture Tab again.
    const visited: string[] = [];
    for (let i = 0; i < 8 && document.activeElement !== screen.getByRole('button', { name: '+ Task' }); i++) {
      await user.tab();
      visited.push(document.activeElement!.getAttribute('aria-label') ?? document.activeElement!.textContent ?? '');
    }
    expect(visited).toEqual(['Indent task 2', 'Move task 2 up', 'Move task 2 down', '+ Note', 'Remove task 2', '+ Task']);
    expect(titles()).toEqual(['Passport', 'Charger', 'Keys']);
    // Back in the list and typing again, Tab indents once more.
    await user.click(task(3));
    await user.keyboard('{Tab}');
    expect(titles()).toEqual(['Passport', 'Charger', '  Keys']);
  });

  it('moves focus between lines with the arrow keys and moves a task with Alt+arrow', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TemplateEditor template={flat} />);
    await user.click(task(1));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(task(2));
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(titles()).toEqual(['Passport', 'Keys', 'Charger']);
    expect((document.activeElement as HTMLInputElement).value).toBe('Charger');
    await user.keyboard('{Alt>}{ArrowUp}{ArrowUp}{ArrowUp}{/Alt}');
    expect(titles()).toEqual(['Charger', 'Passport', 'Keys']);
    await user.click(saveButton());
    expect(saved().entries.map((e: { title: string }) => e.title)).toEqual(['Charger', 'Passport', 'Keys']);
  });

  it('stops at one level of subtasks and explains older deeper nesting', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    const legacy = { ...template, entries: [...template.entries, { key: 'grandchild', title: 'Cable', notes: null, parent_key: 'child' }, { key: 'other', title: 'Other root', notes: null, parent_key: null }] };
    render(<TemplateEditor template={legacy} />);
    expect(task(3).getAttribute('aria-label')).toBe('Task 3, level 3');
    expect(screen.getByText(/Project pages show one level of subtasks, so this task will not appear\./)).toBeTruthy();
    // A subtask cannot be indented again, by key or by button.
    await user.click(task(2));
    await user.keyboard('{Tab}');
    expect(task(2).getAttribute('aria-label')).toBe('Task 2, subtask');
    expect((screen.getByRole('button', { name: 'Indent task 2' }) as HTMLButtonElement).disabled).toBe(true);
    // Untouched, older nesting is saved exactly as it was.
    await user.click(saveButton());
    expect(saved().entries).toEqual([template.entries[0], template.entries[1], legacy.entries[2], legacy.entries[3]]);
    // Outdenting the deep task brings it back into view.
    await user.click(task(3));
    await user.click(screen.getByRole('button', { name: 'Outdent task 3' }));
    expect(task(3).getAttribute('aria-label')).toBe('Task 3, subtask');
    expect(screen.queryByText(/will not appear/)).toBeNull();
  });
});

describe('row tools', () => {
  it('offers only the moves that are possible, and keeps focus on the tool just used', async () => {
    const user = userEvent.setup();
    render(<TemplateEditor template={flat} />);
    await user.click(task(1));
    const tools = within(screen.getByRole('toolbar', { name: 'Task 1 tools' }));
    const disabled = (name: string) => (tools.getByRole('button', { name }) as HTMLButtonElement).disabled;
    expect([disabled('Outdent task 1'), disabled('Indent task 1'), disabled('Move task 1 up'), disabled('Move task 1 down')]).toEqual([true, true, true, false]);
    await user.click(tools.getByRole('button', { name: 'Move task 1 down' }));
    expect(titles()).toEqual(['Charger', 'Passport', 'Keys']);
    // The row moved; its tools moved with it and the same tool is still focused.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move task 2 down' }));
    await user.click(screen.getByRole('button', { name: 'Indent task 2' }));
    expect(titles()).toEqual(['Charger', '  Passport', 'Keys']);
    // Indent is now unavailable, so focus falls back to the line itself.
    expect(document.activeElement).toBe(task(2));
  });

  it('removes a parent and keeps its subtasks and their notes', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TemplateEditor template={template} />);
    await user.click(task(1));
    await user.click(screen.getByRole('button', { name: 'Remove task 1' }));
    expect(titles()).toEqual(['Charger']);
    expect(document.activeElement).toBe(task(1));
    await user.click(saveButton());
    expect(save).toHaveBeenCalledWith({ id: template.id, revision: 2, name: 'Packing', entries: [{ ...template.entries[1], parent_key: null }] });
  });

  it('opens a note under its task, and marks the task once the note is hidden', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TemplateEditor template={flat} />);
    await user.click(task(2));
    await user.click(screen.getByRole('button', { name: '+ Note' }));
    const note = screen.getByRole('textbox', { name: 'Note for task 2' });
    expect(document.activeElement).toBe(note);
    await user.type(note, 'USB-C');
    await user.click(screen.getByRole('button', { name: 'Hide note' }));
    expect(screen.queryByRole('textbox', { name: 'Note for task 2' })).toBeNull();
    expect(document.activeElement).toBe(task(2));
    await user.click(screen.getByRole('button', { name: 'Show note for task 2' }));
    expect((screen.getByRole('textbox', { name: 'Note for task 2' }) as HTMLTextAreaElement).value).toBe('USB-C');
    await user.click(saveButton());
    expect(saved().entries[1]).toEqual({ key: 'charger', title: 'Charger', notes: 'USB-C', parent_key: null });
  });

  it('appends a main task with + Task and focuses it', async () => {
    const user = userEvent.setup();
    render(<TemplateEditor template={template} />);
    await user.click(screen.getByRole('button', { name: '+ Task' }));
    expect(titles()).toEqual(['Passport', '  Charger', '']);
    expect(document.activeElement).toBe(task(3));
  });
});

describe('pasting a list', () => {
  const paste = (element: Element, text: string) => fireEvent.paste(element, { clipboardData: { getData: () => text } });

  it('turns pasted lines into tasks, reading bullets and indentation', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TemplateEditor />);
    await user.type(screen.getByLabelText('Template name'), 'Packing');
    paste(task(1), '- Documents\n  - Passport\n  - [ ] Boarding pass\n- Keys\n');
    expect(titles()).toEqual(['Documents', '  Passport', '  Boarding pass', 'Keys']);
    expect(document.activeElement).toBe(task(4));
    await user.click(saveButton());
    expect(saved().entries.map((e: { title: string; parent_key: string | null }) => [e.title, e.parent_key === null])).toEqual([['Documents', true], ['Passport', false], ['Boarding pass', false], ['Keys', true]]);
  });

  it('leaves a single pasted line to the browser', () => {
    render(<TemplateEditor template={flat} />);
    // Not intercepted: the default action (ordinary paste) is not prevented.
    expect(paste(task(1), 'Passport and visa')).toBe(true);
    expect(titles()).toEqual(['Passport', 'Charger', 'Keys']);
  });

  it('refuses a paste that would pass 200 tasks instead of truncating it', () => {
    const many = { ...template, entries: Array.from({ length: 199 }, (_, i) => ({ key: `k${i}`, title: `Task ${i}`, notes: null, parent_key: null })) };
    render(<TemplateEditor template={many} />);
    paste(task(1), 'One\nTwo');
    expect(screen.getByRole('status').textContent).toBe('That paste would make 2 more tasks. Templates hold up to 200, so nothing was added.');
    expect(screen.getAllByRole('textbox', { name: /^Task \d+/ })).toHaveLength(199);
    expect(screen.getByText(/199 tasks · of 200/)).toBeTruthy();
  });
});

describe('saving', () => {
  it('retains edited text on failure and sends the revision', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Could not save.' });
    render(<TemplateEditor template={template} />);
    await user.clear(task(2));
    await user.type(task(2), 'Medicine');
    await user.click(saveButton());
    expect(save).toHaveBeenCalledWith({ id: template.id, revision: 2, name: 'Packing', entries: [template.entries[0], { ...template.entries[1], title: 'Medicine' }] });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(task(2).value).toBe('Medicine');
    expect(replace).not.toHaveBeenCalled();
    expect(saveButton().closest('fieldset')?.disabled).toBe(false);
  });

  it('ignores blank lines, keeps their subtasks, and asks for at least one task', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TemplateEditor />);
    await user.type(screen.getByLabelText('Template name'), 'Draft');
    await user.click(saveButton());
    expect(screen.getByRole('alert').textContent).toBe('Add at least one task.');
    expect(document.activeElement).toBe(task(1));
    expect(save).not.toHaveBeenCalled();
    // A blank parent line with a real subtask under it, and a trailing blank line.
    await user.click(task(1));
    await user.keyboard('{Enter}Keep me{Tab}{Enter}');
    expect(titles()).toEqual(['', '  Keep me', '  ']);
    await user.click(saveButton());
    expect(saved().entries).toEqual([{ key: expect.any(String), title: 'Keep me', notes: null, parent_key: null }]);
  });

  it('marks and focuses the task a failed save points at', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Check the marked fields.', fieldErrors: { 'entries.child': 'Enter a title of up to 500 characters.' } });
    render(<TemplateEditor template={template} />);
    await user.click(saveButton());
    expect(document.activeElement).toBe(task(2));
    expect(task(2).getAttribute('aria-invalid')).toBe('true');
    expect(task(2).closest('[data-row]')!.className).toContain('border-accent');
    expect(document.getElementById(task(2).getAttribute('aria-describedby')!)?.textContent).toBe('Enter a title of up to 500 characters.');
    expect(task(1).getAttribute('aria-invalid')).toBe('false');
    expect(task(1).closest('[data-row]')!.className).not.toContain('border-accent');
  });

  it('refuses to drop an untitled task that has a note and points at that row', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TemplateEditor template={template} />);
    await user.clear(task(2));
    await user.click(saveButton());
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Add a title to each task that has a note, or clear the note.');
    expect(document.activeElement).toBe(task(2));
    expect(document.getElementById(task(2).getAttribute('aria-describedby')!)?.textContent).toBe('Add a title, or clear this task’s note.');
    // Backspace does not quietly remove a line that still holds a note.
    await user.keyboard('{Backspace}');
    expect(titles()).toEqual(['Passport', '  ']);
    await user.type(task(2), 'Cable');
    await user.click(saveButton());
    expect(saved().entries).toEqual([template.entries[0], { ...template.entries[1], title: 'Cable' }]);
  });

  it('shows the count and an unsaved marker beside the actions', async () => {
    const user = userEvent.setup();
    render(<TemplateEditor template={template} />);
    expect(screen.getByText('2 tasks · 1 group')).toBeTruthy();
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
    await user.type(task(2), ' and cable');
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
    expect(screen.getByText('Changes apply to future projects. Existing projects keep their own tasks and progress.')).toBeTruthy();
  });
});

describe('conflicts', () => {
  const conflict = { ok: false, error: 'This template was saved in another window after you opened it. Your edits are still here.', currentRevision: 3 };

  it('keeps a conflicting draft and explicitly overwrites using the latest revision', async () => {
    const user = userEvent.setup();
    save.mockResolvedValueOnce(conflict).mockResolvedValueOnce({ ...conflict, currentRevision: 4 }).mockResolvedValueOnce({ ok: true, value: { ...template, name: 'My version', revision: 5 } });
    render(<TemplateEditor template={template} />);
    await user.clear(screen.getByLabelText('Template name'));
    await user.type(screen.getByLabelText('Template name'), 'My version');
    await user.click(saveButton());
    expect(screen.getByRole('alert').textContent).toBe(conflict.error);
    expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('My version');
    await user.click(screen.getByRole('button', { name: 'Save mine over it' }));
    expect(saved(1)).toMatchObject({ revision: 3, name: 'My version', entries: template.entries });
    await user.click(screen.getByRole('button', { name: 'Save mine over it' }));
    expect(saved(2)).toMatchObject({ revision: 4, name: 'My version' });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/task-templates'));
  });

  it('discards a conflicting draft only after loading succeeds, then counts as clean', async () => {
    const user = userEvent.setup();
    save.mockResolvedValueOnce(conflict).mockResolvedValueOnce({ ok: false, error: 'Try again' });
    load.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, value: { ...template, name: 'Saved version', entries: [{ ...template.entries[0], title: 'Saved task' }], revision: 4 } });
    render(<TemplateEditor template={template} />);
    await user.type(task(1), ' draft');
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Discard mine, load saved version' }));
    expect(task(1).value).toBe('Passport draft');
    expect(leaving()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Discard mine, load saved version' }));
    expect(load).toHaveBeenCalledWith(template.id);
    expect(titles()).toEqual(['Saved task']);
    expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('Saved version');
    // The loaded version is the saved one, so there is nothing left to guard.
    expect(leaving()).toBe(false);
    await user.click(saveButton());
    expect(saved(1)).toMatchObject({ revision: 4, name: 'Saved version' });
  });
});

describe('leaving the editor', () => {
  it('lets Cancel leave a clean draft and asks before discarding a changed one', async () => {
    const user = userEvent.setup();
    render(<TemplateEditor template={template} />);
    const cancel = screen.getByRole('link', { name: 'Cancel' });
    expect(cancel.getAttribute('href')).toBe('/task-templates');
    expect(leaving()).toBe(false);
    fireEvent.click(cancel);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.type(screen.getByLabelText('Template name'), ' for flights');
    expect(leaving()).toBe(true);
    fireEvent.click(cancel);
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('Packing for flights');
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(replace).toHaveBeenCalledWith('/task-templates');
  });

  it('opens a duplicate prefilled, treats it as clean, and saves it as a new template', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: true, value: { ...template, id: 'template-2', name: 'Packing copy' } });
    const initial = { name: 'Packing copy', entries: [{ ...template.entries[0]!, key: 'new-parent' }, { ...template.entries[1]!, key: 'new-child', parent_key: 'new-parent' }] };
    render(<TemplateEditor initial={initial} />);
    expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('Packing copy');
    expect(titles()).toEqual(['Passport', '  Charger']);
    // Nothing typed yet, so leaving loses nothing. Opening and closing a note is not an edit either.
    await user.click(screen.getByRole('button', { name: 'Show note for task 1' }));
    expect(leaving()).toBe(false);
    await user.click(saveButton());
    expect(save).toHaveBeenCalledWith({ id: undefined, revision: undefined, name: 'Packing copy', entries: initial.entries });
  });
});
