import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateLibrary } from './template-library';

const { create, remove, push, refresh } = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('./actions', () => ({ createProjectFromTemplate: create, deleteTaskTemplate: remove }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
const template = { id: 'template-1', name: 'Packing', entries: [{ key: 'parent', title: 'Passport', notes: 'Check expiry', parent_key: null }, { key: 'child', title: 'Charger', notes: 'USB-C', parent_key: 'parent' }], revision: 2, created_at: '', updated_at: '' };
const flat = { ...template, id: 'template-2', name: 'Hosting guests', entries: ['Fresh towels', 'Spare key', 'Stock the fridge', 'Air the room', 'Wifi card'].map(title => ({ key: title, title, notes: null, parent_key: null })) };
const domains = [{ id: 'domain-1', name: 'Personal' }];
const edited = { 'template-1': 'Oct 12', 'template-2': 'Jul 30' };
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); });
const row = (name: string) => screen.getByRole('heading', { name }).closest('li')!;

describe('library rows', () => {
  it('names each template as a link to its editor, with counts, edit date and a peek', () => {
    render(<TemplateLibrary initialTemplates={[template, flat]} edited={edited} domains={domains} />);
    expect(screen.getByRole('link', { name: 'Packing' }).getAttribute('href')).toBe('/task-templates/template-1');
    expect(within(row('Packing')).getByText('2 tasks · 1 group · edited Oct 12')).toBeTruthy();
    expect(within(row('Packing')).getByText('Passport')).toBeTruthy();
    // No subtasks: the groups segment is left out. More than four main tasks: the peek trails off.
    expect(within(row('Hosting guests')).getByText('5 tasks · edited Jul 30')).toBeTruthy();
    expect(within(row('Hosting guests')).getByText('Fresh towels, Spare key, Stock the fridge, Air the room…')).toBeTruthy();
    // Use is the one button on a row; everything else is in the menu.
    expect(within(row('Packing')).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Use Packing', 'More actions for Packing']);
  });

  it('explains both ways to make a first template when the library is empty', () => {
    render(<TemplateLibrary initialTemplates={[]} edited={{}} domains={domains} />);
    expect(screen.getByText('No templates yet. Choose + Template to write one, or open any project and choose Save as template in its Tasks section.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('follows the server list when it changes', () => {
    const { rerender } = render(<TemplateLibrary initialTemplates={[template]} edited={edited} domains={domains} />);
    rerender(<TemplateLibrary initialTemplates={[template, flat]} edited={edited} domains={domains} />);
    expect(screen.getByRole('heading', { name: 'Hosting guests' })).toBeTruthy();
  });
});

describe('row menu', () => {
  it('opens to Edit, Duplicate and Delete, with arrow keys and Escape', async () => {
    const user = userEvent.setup();
    render(<TemplateLibrary initialTemplates={[template]} edited={edited} domains={domains} />);
    const trigger = screen.getByRole('button', { name: 'More actions for Packing' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const items = within(screen.getByRole('menu', { name: 'Actions for Packing' })).getAllByRole('menuitem');
    expect(items.map(item => item.textContent)).toEqual(['Edit', 'Duplicate', 'Delete…']);
    expect(items[0]!.getAttribute('href')).toBe('/task-templates/template-1');
    expect(items[1]!.getAttribute('href')).toBe('/task-templates/new?from=template-1');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(items[2]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    // A press outside the menu closes it too.
    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('confirms deletion inline, keeps the row on cancel or failure, then removes it on success', async () => {
    const user = userEvent.setup();
    remove.mockResolvedValueOnce({ ok: false, error: 'Could not delete this template. Please try again.' }).mockResolvedValueOnce({ ok: true, value: null });
    render(<TemplateLibrary initialTemplates={[template]} edited={edited} domains={domains} />);
    const openDelete = async () => {
      await user.click(screen.getByRole('button', { name: 'More actions for Packing' }));
      await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    };
    await openDelete();
    expect(remove).not.toHaveBeenCalled();
    // Focus follows the confirmation: to Cancel on open, back to the menu on close.
    expect(screen.getByRole('group', { name: /Delete “Packing”\?/ })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More actions for Packing' }));
    expect(screen.getByRole('button', { name: 'Use Packing' })).toBeTruthy();
    await openDelete();
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(screen.getByRole('heading', { name: 'Packing' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Could not delete this template. Please try again.');
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(remove).toHaveBeenCalledWith(template.id);
    expect(screen.queryByRole('heading', { name: 'Packing' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Deleted “Packing”. Existing projects are unchanged.');
  });
});

describe('using a template', () => {
  it('keeps the draft and blocks duplicate submissions while creating, then opens the new project', async () => {
    const user = userEvent.setup();
    let resolve!: (value: unknown) => void;
    create.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<TemplateLibrary initialTemplates={[template]} edited={edited} domains={domains} initialDomainId="domain-1" />);
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
    render(<TemplateLibrary initialTemplates={[template]} edited={edited} domains={domains} />);
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

  it('shows API field errors beside the fields that failed, visibly marked and focused', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({ ok: false, error: 'Check the marked fields.', fieldErrors: { domain_id: 'Choose an available domain.' } });
    render(<TemplateLibrary initialTemplates={[template]} edited={edited} domains={domains} />);
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
    // Cancel returns to the list without creating anything.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Packing' })).toBeTruthy();
  });
});
