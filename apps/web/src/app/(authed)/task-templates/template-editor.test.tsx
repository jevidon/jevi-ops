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
// jsdom cannot navigate: swallow link clicks the leave guard lets through.
const swallow = (event: Event) => { if ((event.target as Element).closest('a')) event.preventDefault(); };
const leaving = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); document.removeEventListener('click', swallow); });
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState(null, '', '/task-templates/template-1'); document.addEventListener('click', swallow); });

describe('editing a template', () => {
  it('keeps notes and promotes subtasks when removing their parent', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TemplateEditor template={template} />);
    // The parent cannot be made a child of its own descendant.
    expect(screen.queryByLabelText('Parent for task 1')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove task 1' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save).toHaveBeenCalledWith({ id: template.id, revision: 2, name: 'Packing', entries: [{ ...template.entries[1], parent_key: null }] });
  });

  it('creates a named list with notes and subtasks, then returns to the library with a confirmation', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: true, value: template });
    render(<TemplateEditor />);
    await user.type(screen.getByLabelText('Template name'), 'Packing');
    await user.type(screen.getByLabelText('Task 1', { exact: true }), 'Passport');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await user.type(screen.getByLabelText('Task 2', { exact: true }), 'Charger');
    await user.selectOptions(screen.getByLabelText('Parent for task 2'), screen.getByRole('option', { name: 'Passport' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save).toHaveBeenCalledWith({ id: undefined, revision: undefined, name: 'Packing', entries: [{ key: expect.any(String), title: 'Passport', notes: null, parent_key: null }, { key: expect.any(String), title: 'Charger', notes: null, parent_key: save.mock.calls[0]![0].entries[0].key }] });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/task-templates'));
    expect(refresh).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith({ message: 'Saved “Packing”. Existing projects keep their tasks and progress.' });
    // The save was a decision to leave: the guard does not ask about it.
    expect(leaving()).toBe(false);
  });

  it('retains edited text on failure and sends the revision', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Could not save.' });
    render(<TemplateEditor template={template} />);
    const title = screen.getByLabelText('Task 2', { exact: true }) as HTMLInputElement;
    await user.clear(title);
    await user.type(title, 'Medicine');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save).toHaveBeenCalledWith({ id: template.id, revision: 2, name: 'Packing', entries: [template.entries[0], { ...template.entries[1], title: 'Medicine' }] });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(title.value).toBe('Medicine');
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save template' }).closest('fieldset')?.disabled).toBe(false);
  });

  it('focuses added tasks, labels untitled parents, drops blanks and promotes their children', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TemplateEditor />);
    await user.type(screen.getByLabelText('Template name'), 'Draft');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(screen.getByRole('alert').textContent).toBe('Add at least one task.');
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Task 2', { exact: true }));
    await user.type(document.activeElement!, 'Keep me');
    await user.selectOptions(screen.getByLabelText('Parent for task 2'), screen.getByRole('option', { name: 'Task 1 (untitled)' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save.mock.calls[0]![0].entries).toEqual([{ key: expect.any(String), title: 'Keep me', notes: null, parent_key: null }]);
  });

  it('limits new parents to root tasks while preserving existing deeper entries and notes', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    const legacy = { ...template, entries: [...template.entries, { key: 'grandchild', title: 'Cable', notes: null, parent_key: 'child' }, { key: 'other', title: 'Other root', notes: null, parent_key: null }] };
    render(<TemplateEditor template={legacy} />);
    expect(screen.queryByLabelText('Parent for task 1')).toBeNull();
    expect(screen.queryByLabelText('Parent for task 2')).toBeNull();
    // Group headings state what they are; only the legacy nested parent warns.
    expect(screen.getByText('Main task · 1 subtask')).toBeTruthy();
    expect(screen.getByText(/Subtask with 1 subtask of its own, which project pages do not show\./)).toBeTruthy();
    expect(screen.getAllByText('Notes · has a note')).toHaveLength(2);
    const parent = screen.getByLabelText('Parent for task 3') as HTMLSelectElement;
    expect(parent.value).toBe('child');
    expect(within(parent).getByRole('option', { name: 'Charger (existing nested parent)' }).hasAttribute('disabled')).toBe(true);
    const root = screen.getByLabelText('Parent for task 4');
    expect(within(root).queryByRole('option', { name: 'Charger' })).toBeNull();
    expect(within(root).queryByRole('option', { name: 'Cable' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Tasks (4)' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save.mock.calls[0]![0].entries).toEqual(legacy.entries);
  });

  it('marks and focuses the task a failed save points at, far from the Save button', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Check the marked fields.', fieldErrors: { 'entries.child': 'Enter a title of up to 500 characters.' } });
    render(<TemplateEditor template={template} />);
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    const marked = screen.getByLabelText('Task 2', { exact: true });
    expect(document.activeElement).toBe(marked);
    expect(marked.getAttribute('aria-invalid')).toBe('true');
    expect(marked.className).toContain('border-accent');
    expect(document.getElementById(marked.getAttribute('aria-describedby')!)?.textContent).toBe('Enter a title of up to 500 characters.');
    const clean = screen.getByLabelText('Task 1', { exact: true });
    expect(clean.getAttribute('aria-invalid')).toBe('false');
    expect(clean.className).not.toContain('border-accent');
  });

  it('refuses to drop an untitled task that has a note and points at that row', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TemplateEditor template={template} />);
    const title = screen.getByLabelText('Task 2', { exact: true }) as HTMLInputElement;
    await user.clear(title);
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Add a title to each task that has a note, or clear the note.');
    expect(document.activeElement).toBe(title);
    expect(document.getElementById(title.getAttribute('aria-describedby')!)?.textContent).toBe('Add a title, or clear this task’s note.');
    expect((screen.getByLabelText('Notes for task 2') as HTMLTextAreaElement).value).toBe('USB-C');
    // Either fix works: give it a title, and the note is saved with it.
    await user.type(title, 'Cable');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save.mock.calls[0]![0].entries).toEqual([template.entries[0], { ...template.entries[1], title: 'Cable' }]);
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
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(screen.getByRole('alert').textContent).toBe(conflict.error);
    expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('My version');
    await user.click(screen.getByRole('button', { name: 'Save mine over it' }));
    expect(save.mock.calls[1]![0]).toMatchObject({ revision: 3, name: 'My version', entries: template.entries });
    await user.click(screen.getByRole('button', { name: 'Save mine over it' }));
    expect(save.mock.calls[2]![0]).toMatchObject({ revision: 4, name: 'My version' });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/task-templates'));
  });

  it('discards a conflicting draft only after loading succeeds, then counts as clean', async () => {
    const user = userEvent.setup();
    save.mockResolvedValueOnce(conflict).mockResolvedValueOnce({ ok: false, error: 'Try again' });
    load.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, value: { ...template, name: 'Saved version', entries: [{ ...template.entries[0], title: 'Saved task' }], revision: 4 } });
    render(<TemplateEditor template={template} />);
    await user.type(screen.getByLabelText('Task 1', { exact: true }), ' draft');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await user.click(screen.getByRole('button', { name: 'Discard mine, load saved version' }));
    expect((screen.getByLabelText('Task 1', { exact: true }) as HTMLInputElement).value).toBe('Passport draft');
    expect(leaving()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Discard mine, load saved version' }));
    expect(load).toHaveBeenCalledWith(template.id);
    expect((screen.getByLabelText('Task 1', { exact: true }) as HTMLInputElement).value).toBe('Saved task');
    expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('Saved version');
    expect(screen.queryByLabelText('Task 2', { exact: true })).toBeNull();
    // The loaded version is the saved one, so there is nothing left to guard.
    expect(leaving()).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save.mock.calls[1]![0]).toMatchObject({ revision: 4, name: 'Saved version' });
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
    expect(screen.getByText('Main task · 1 subtask')).toBeTruthy();
    // Nothing typed yet, so leaving loses nothing.
    expect(leaving()).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save).toHaveBeenCalledWith({ id: undefined, revision: undefined, name: 'Packing copy', entries: initial.entries });
  });
});
