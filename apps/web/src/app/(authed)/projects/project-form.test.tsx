import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectForm } from './project-form';

const { create, update } = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('./actions', () => ({ createProjectAction: create, updateProjectAction: update, deleteProjectAction: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

const blank = { name: '', description: '', domain_id: '', type: '' as const, status: 'active' as const, engagement_type: 'project' as const, kind: 'project' as const, quoted_hours: '', retainer_anchor_day: '', start_date: '', target_date: '', color: '' };
const domains = [{ id: 'domain-1', name: 'Travel' }];
const entry = (key: string, title: string, parent_key: string | null = null) => ({ key, title, notes: null, parent_key });
const packing = { id: '11111111-1111-4111-8111-111111111111', name: 'Packing for a flight', entries: [
  entry('docs', 'Documents'), entry('passport', 'Passport', 'docs'), entry('pass', 'Boarding pass', 'docs'),
  ...['Electronics', 'Toiletries', 'Clothes', 'Refill prescriptions', 'Leave keys', 'Bins out', 'Water plants'].map(title => entry(title, title)),
] };
const camping = { id: '22222222-2222-4222-8222-222222222222', name: 'Weekend camping', entries: [entry('tent', 'Tent')] };
const templates = [packing, camping];
/** The FormData handed to the create action on its nth call. */
const sent = (call = 0) => Object.fromEntries((create.mock.calls[call]![1] as FormData).entries());
const startWith = () => screen.getByRole('radiogroup', { name: 'Start with' });
const submit = () => screen.getByRole('button', { name: 'Create project' });

describe('Start with', () => {
  it('is offered only when creating a project and a template exists', () => {
    const { rerender } = render(<ProjectForm initial={blank} domains={domains} />);
    expect(screen.queryByRole('radiogroup', { name: 'Start with' })).toBeNull();
    rerender(<ProjectForm initial={{ ...blank, id: 'project-1' }} domains={domains} templates={templates} />);
    expect(screen.queryByRole('radiogroup', { name: 'Start with' })).toBeNull();
    rerender(<ProjectForm initial={blank} domains={domains} templates={templates} />);
    expect(within(startWith()).getAllByRole('radio').map(radio => (radio as HTMLInputElement).checked)).toEqual([true, false]);
    // No template is chosen until asked for.
    expect(screen.queryByLabelText('Template')).toBeNull();
  });

  it('shows the chosen template: main tasks with subtask counts, cut off with a count of the rest', async () => {
    const user = userEvent.setup();
    render(<ProjectForm initial={blank} domains={domains} templates={templates} />);
    await user.click(within(startWith()).getByRole('radio', { name: /A task template/ }));
    expect(within(screen.getByLabelText('Template')).getAllByRole('option').map(option => option.textContent)).toEqual(['Packing for a flight · 10 tasks', 'Weekend camping · 1 task']);
    const preview = within(screen.getByRole('list', { name: 'Tasks in Packing for a flight' }));
    expect(preview.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Documents2 subtasks', 'Electronics', 'Toiletries', 'Clothes', 'Refill prescriptions', 'Leave keys', '+ 2 more']);
    expect(screen.getByText('Every task starts open, without dates or reminders.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Template'), camping.id);
    expect(within(screen.getByRole('list', { name: 'Tasks in Weekend camping' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Tent']);
  });

  it('sends the template only when one is chosen, and switching never clears what was typed', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({ ok: false, error: 'Stop here' });
    render(<ProjectForm initial={blank} domains={domains} templates={templates} />);
    await user.type(screen.getByLabelText('Name (required)'), 'December trip');
    await user.type(screen.getByLabelText('Description'), 'Two weeks away');
    await user.selectOptions(screen.getByLabelText('Domain'), 'domain-1');
    await user.click(within(startWith()).getByRole('radio', { name: /A task template/ }));
    await user.selectOptions(screen.getByLabelText('Template'), camping.id);
    expect((screen.getByLabelText('Name (required)') as HTMLInputElement).value).toBe('December trip');
    await user.click(submit());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ name: 'December trip', description: 'Two weeks away', domain_id: 'domain-1', kind: 'project', template_id: camping.id });
    // Back to no tasks: the choice is dropped, everything else stays.
    await user.click(within(startWith()).getByRole('radio', { name: /No tasks/ }));
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Two weeks away');
    await user.click(submit());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(sent(1)).toMatchObject({ name: 'December trip', template_id: '' });
  });

  it('opens with the template from the link preselected, and ignores an unknown id', async () => {
    const { unmount } = render(<ProjectForm initial={blank} domains={domains} templates={templates} initialTemplateId={camping.id} />);
    expect((within(startWith()).getByRole('radio', { name: /A task template/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Template') as HTMLSelectElement).value).toBe(camping.id);
    unmount();
    render(<ProjectForm initial={blank} domains={domains} templates={templates} initialTemplateId="gone" />);
    expect((within(startWith()).getByRole('radio', { name: /No tasks/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('does not apply to an area: the choice disappears and no template is sent', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({ ok: false, error: 'Stop here' });
    render(<ProjectForm initial={blank} domains={domains} templates={templates} initialTemplateId={packing.id} />);
    await user.type(screen.getByLabelText('Name (required)'), 'Garage');
    await user.click(screen.getByRole('button', { name: /^Area/ }));
    expect(screen.queryByRole('radiogroup', { name: 'Start with' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create area' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ name: 'Garage', kind: 'area', template_id: '' });
  });
});

describe('creating', () => {
  it('keeps the whole draft when the create fails, shows why, and allows a retry', async () => {
    const user = userEvent.setup();
    create.mockResolvedValueOnce({ ok: false, error: 'That template is no longer available. Choose another, or start with no tasks. Nothing was created.' }).mockResolvedValueOnce({ ok: false, error: 'Again' });
    render(<ProjectForm initial={blank} domains={domains} templates={templates} initialTemplateId={packing.id} />);
    await user.type(screen.getByLabelText('Name (required)'), 'December trip');
    await user.type(screen.getByLabelText('Description'), 'Two weeks away');
    await user.selectOptions(screen.getByLabelText('Domain'), 'domain-1');
    await user.click(submit());
    expect(await screen.findByText(/That template is no longer available/)).toBeTruthy();
    // Nothing typed or chosen is lost to the failure.
    expect((screen.getByLabelText('Name (required)') as HTMLInputElement).value).toBe('December trip');
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Two weeks away');
    expect((screen.getByLabelText('Domain') as HTMLSelectElement).value).toBe('domain-1');
    expect((screen.getByLabelText('Template') as HTMLSelectElement).value).toBe(packing.id);
    await user.selectOptions(screen.getByLabelText('Template'), camping.id);
    await user.click(submit());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(sent(1)).toMatchObject({ name: 'December trip', template_id: camping.id });
  });

  it('submits once while a create is in flight', async () => {
    const user = userEvent.setup();
    let resolve!: (value: unknown) => void;
    create.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<ProjectForm initial={blank} domains={domains} templates={templates} />);
    await user.type(screen.getByLabelText('Name (required)'), 'December trip');
    const form = submit().closest('form')!;
    await user.click(submit());
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy());
    expect(create).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true);
    // Once the action answers, the form accepts another attempt.
    await act(async () => { resolve({ ok: false, error: 'Try again' }); });
    await user.click(await screen.findByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  });
});
