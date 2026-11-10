import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskTemplates } from './task-templates';

const { save, create, load, remove, push, refresh } = vi.hoisted(() => ({ save: vi.fn(), create: vi.fn(), load: vi.fn(), remove: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('./actions', () => ({ saveTaskTemplate: save, createProjectFromTemplate: create, loadTaskTemplate: load, deleteTaskTemplate: remove }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
const template = { id: 'template-1', name: 'Packing', entries: [{ key: 'parent', title: 'Passport', notes: 'Check expiry', parent_key: null }, { key: 'child', title: 'Charger', notes: 'USB-C', parent_key: 'parent' }], revision: 2, created_at: '', updated_at: '' };
const domains = [{ id: 'domain-1', name: 'Personal' }];
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); });

describe('task templates', () => {
  it('keeps notes and promotes subtasks when removing their parent', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'Try again' });
    render(<TaskTemplates initialTemplates={[template]} domains={domains} />);
    await user.click(screen.getByRole('button', { name: 'Edit Packing' }));
    // The parent cannot be made a child of its own descendant.
    expect(screen.queryByLabelText('Parent for task 1')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove task 1' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save).toHaveBeenCalledWith({ id: template.id, revision: 2, name: 'Packing', entries: [{ ...template.entries[1], parent_key: null }] });
  });

  it('creates a named list with notes and subtasks and makes the saved template available to use', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: true, value: template });
    render(<TaskTemplates initialTemplates={[]} domains={domains} />);
    expect(screen.queryByLabelText('Template name')).toBeNull();
    expect(screen.getByText('Or open any project and choose Save as template in its Tasks section.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.type(screen.getByLabelText('Template name'), 'Packing');
    await user.type(screen.getByLabelText('Task 1', { exact: true }), 'Passport');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await user.type(screen.getByLabelText('Task 2', { exact: true }), 'Charger');
    await user.selectOptions(screen.getByLabelText('Parent for task 2'), screen.getByRole('option', { name: 'Passport' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save).toHaveBeenCalledWith({ id: undefined, revision: undefined, name: 'Packing', entries: [{ key: expect.any(String), title: 'Passport', notes: null, parent_key: null }, { key: expect.any(String), title: 'Charger', notes: null, parent_key: save.mock.calls[0]![0].entries[0].key }] });
    expect(await screen.findByRole('button', { name: 'Use Packing' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Existing projects keep');
  });

  it('retains edited text on failure and sends the revision while adding and removing tasks', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: false, error: 'This template changed in another window.' });
    render(<TaskTemplates initialTemplates={[template]} domains={domains} />);
    await user.click(screen.getByRole('button', { name: 'Edit Packing' }));
    const title = screen.getByLabelText('Task 2', { exact: true }) as HTMLInputElement;
    await user.clear(title);
    await user.type(title, 'Medicine');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save).toHaveBeenCalledWith({ id: template.id, revision: 2, name: 'Packing', entries: [template.entries[0], { ...template.entries[1], title: 'Medicine' }] });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(title.value).toBe('Medicine');
  });

  it('keeps the draft and blocks duplicate submissions while creating, then opens the new project', async () => {
    const user = userEvent.setup();
    let resolve!: (value: unknown) => void;
    create.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<TaskTemplates initialTemplates={[template]} domains={domains} initialDomainId="domain-1" />);
    await user.click(screen.getByRole('button', { name: 'Use Packing' }));
    await user.type(screen.getByLabelText('New project name'), 'December trip');
    const button = screen.getByRole('button', { name: 'Create project' });
    const form = button.closest('form')!;
    await user.click(button);
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ template_id: template.id, name: 'December trip', domain_id: 'domain-1' });
    expect((screen.getByLabelText('New project name') as HTMLInputElement).value).toBe('December trip');
    expect(screen.getByRole('button', { name: 'Creating…' }).closest('fieldset')?.disabled).toBe(true);
    resolve({ ok: true, value: { id: 'new-project' } });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/new-project'));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('retains project name and domain on a failed create and allows retry', async () => {
    const user = userEvent.setup();
    create.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ ok: true, value: { id: 'retry-project' } });
    render(<TaskTemplates initialTemplates={[template]} domains={domains} />);
    await user.click(screen.getByRole('button', { name: 'Use Packing' }));
    await user.type(screen.getByLabelText('New project name'), 'Road trip');
    await user.selectOptions(screen.getByLabelText('Domain'), 'domain-1');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('New project name') as HTMLInputElement).value).toBe('Road trip');
    expect((screen.getByLabelText('Domain') as HTMLSelectElement).value).toBe('domain-1');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/retry-project'));
  });
});

const conflict = { ok: false, error: 'This template was saved in another window after you opened it. Your edits are still here.', currentRevision: 3 };

it('keeps a conflicting draft and explicitly overwrites using the latest revision', async () => {
  const user = userEvent.setup();
  save.mockResolvedValueOnce(conflict).mockResolvedValueOnce({ ...conflict, currentRevision: 4 }).mockResolvedValueOnce({ ok: true, value: { ...template, name: 'My version', revision: 5 } });
  render(<TaskTemplates initialTemplates={[template]} domains={domains} />);
  await user.click(screen.getByRole('button', { name: 'Edit Packing' }));
  await user.clear(screen.getByLabelText('Template name'));
  await user.type(screen.getByLabelText('Template name'), 'My version');
  await user.click(screen.getByRole('button', { name: 'Save template' }));
  expect(screen.getByRole('alert').textContent).toBe(conflict.error);
  expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('My version');
  await user.click(screen.getByRole('button', { name: 'Save mine over it' }));
  expect(save.mock.calls[1]![0]).toMatchObject({ revision: 3, name: 'My version', entries: template.entries });
  await user.click(screen.getByRole('button', { name: 'Save mine over it' }));
  expect(save.mock.calls[2]![0]).toMatchObject({ revision: 4, name: 'My version' });
  expect(await screen.findByRole('button', { name: 'Use My version' })).toBeTruthy();
});

it('discards a conflicting draft only after loading succeeds and uses the loaded revision', async () => {
  const user = userEvent.setup();
  save.mockResolvedValueOnce(conflict).mockResolvedValueOnce({ ok: false, error: 'Try again' });
  load.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, value: { ...template, name: 'Saved version', entries: [{ ...template.entries[0], title: 'Saved task' }], revision: 4 } });
  render(<TaskTemplates initialTemplates={[template]} domains={domains} />);
  await user.click(screen.getByRole('button', { name: 'Edit Packing' }));
  await user.type(screen.getByLabelText('Task 1', { exact: true }), ' draft');
  await user.click(screen.getByRole('button', { name: 'Save template' }));
  await user.click(screen.getByRole('button', { name: 'Discard mine, load saved version' }));
  expect((screen.getByLabelText('Task 1', { exact: true }) as HTMLInputElement).value).toBe('Passport draft');
  await user.click(screen.getByRole('button', { name: 'Discard mine, load saved version' }));
  expect(load).toHaveBeenCalledWith(template.id);
  expect((screen.getByLabelText('Task 1', { exact: true }) as HTMLInputElement).value).toBe('Saved task');
  expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('Saved version');
  expect(screen.queryByLabelText('Task 2', { exact: true })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Save template' }));
  expect(save.mock.calls[1]![0]).toMatchObject({ revision: 4, name: 'Saved version' });
});

it('confirms deletion inline, preserves the row on cancel or failure, then removes it on success', async () => {
  const user = userEvent.setup();
  remove.mockResolvedValueOnce({ ok: false, error: 'Try again' }).mockResolvedValueOnce({ ok: true, value: null });
  render(<TaskTemplates initialTemplates={[template]} domains={domains} />);
  // Use leads the row; Delete is last and not styled as an equal-weight button.
  const row = screen.getByRole('heading', { name: 'Packing' }).closest('li')!;
  expect(within(row).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Use Packing', 'Edit Packing', 'Delete Packing']);
  expect(screen.getByRole('button', { name: 'Delete Packing' }).className).not.toContain('border');
  await user.click(screen.getByRole('button', { name: 'Delete Packing' }));
  expect(remove).not.toHaveBeenCalled();
  // Focus follows the confirmation: to Cancel on open, back to Delete on close.
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('group', { name: /Delete “Packing”\?/ })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete Packing' }));
  expect(screen.getByRole('button', { name: 'Use Packing' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Delete Packing' }));
  await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(screen.getByRole('heading', { name: 'Packing' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('Try again');
  await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(remove).toHaveBeenCalledWith(template.id);
  expect(screen.queryByRole('heading', { name: 'Packing' })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Deleted');
});

it('focuses added tasks, labels untitled parents, drops blanks and promotes their children', async () => {
  const user = userEvent.setup();
  save.mockResolvedValue({ ok: false, error: 'Try again' });
  render(<TaskTemplates initialTemplates={[]} domains={domains} />);
  await user.click(screen.getByRole('button', { name: 'New template' }));
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
  render(<TaskTemplates initialTemplates={[legacy]} domains={domains} />);
  await user.click(screen.getByRole('button', { name: 'Edit Packing' }));
  expect(screen.queryByLabelText('Parent for task 1')).toBeNull();
  expect(screen.queryByLabelText('Parent for task 2')).toBeNull();
  // Group headings state what they are; only the legacy nested parent warns.
  expect(screen.getByText('Main task · 1 subtask')).toBeTruthy();
  expect(screen.getByText(/Subtask with 1 subtask of its own, which project pages do not show\./)).toBeTruthy();
  expect(screen.queryByText(/cannot be assigned a new parent/)).toBeNull();
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

it('shows API field errors beside the fields that failed, visibly marked and focused', async () => {
  const user = userEvent.setup();
  create.mockResolvedValue({ ok: false, error: 'Check the marked fields.', fieldErrors: { domain_id: 'Choose an available domain.' } });
  render(<TaskTemplates initialTemplates={[template]} domains={domains} />);
  await user.click(screen.getByRole('button', { name: 'Use Packing' }));
  await user.type(screen.getByLabelText('New project name'), 'Trip');
  await user.click(screen.getByRole('button', { name: 'Create project' }));
  const domain = screen.getByLabelText('Domain');
  expect(domain.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(domain.getAttribute('aria-describedby')!)?.textContent).toBe('Choose an available domain.');
  expect(domain.className).toContain('border-accent');
  expect(domain.className).not.toContain('border-line');
  expect(screen.getByLabelText('New project name').className).toContain('border-line');
  expect(document.activeElement).toBe(domain);
});

it('marks and focuses the task a failed save points at, far from the Save button', async () => {
  const user = userEvent.setup();
  save.mockResolvedValue({ ok: false, error: 'Check the marked fields.', fieldErrors: { 'entries.child': 'Enter a title of up to 500 characters.' } });
  render(<TaskTemplates initialTemplates={[template]} domains={domains} />);
  await user.click(screen.getByRole('button', { name: 'Edit Packing' }));
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
  save.mockResolvedValue({ ok: true, value: template });
  render(<TaskTemplates initialTemplates={[template]} domains={domains} />);
  await user.click(screen.getByRole('button', { name: 'Edit Packing' }));
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
