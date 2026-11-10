import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskTemplates } from './task-templates';

const { save, create, push, refresh } = vi.hoisted(() => ({ save: vi.fn(), create: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('./actions', () => ({ saveTaskTemplate: save, createProjectFromTemplate: create }));
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
    expect((screen.getByLabelText('Parent for task 1') as HTMLSelectElement).options).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Remove task 1' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(save).toHaveBeenCalledWith({ id: template.id, revision: 2, name: 'Packing', entries: [{ ...template.entries[1], parent_key: null }] });
  });

  it('creates a named list with notes and subtasks and makes the saved template available to use', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: true, value: template });
    render(<TaskTemplates initialTemplates={[]} domains={domains} />);
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
