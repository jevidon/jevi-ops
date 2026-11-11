import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTasksSection } from './project-tasks-section';

const { saveNew, list, snapshot, update, load } = vi.hoisted(() => ({ saveNew: vi.fn(), list: vi.fn(), snapshot: vi.fn(), update: vi.fn(), load: vi.fn() }));
vi.mock('../../task-templates/actions', () => ({ saveProjectAsTemplate: saveNew, listTaskTemplates: list, loadProjectSnapshot: snapshot, saveTaskTemplate: update, loadTaskTemplate: load }));
afterEach(cleanup);

const entry = (prefix: string) => (title: string, parent: string | null = null, notes: string | null = null) => ({ key: `${prefix}:${title}`, title, notes, parent_key: parent ? `${prefix}:${parent}` : null });
const p = entry('p');
const t = entry('t');
const c = entry('c');
// This trip's project: the flight list plus an ESTA printout and a gift, minus the sunscreen.
const tasks = [p('Documents'), p('Passport', 'Documents'), p('ESTA printout', 'Documents'), p('Keys'), p('Gift for Sam')];
const flight = { id: 'tpl-1', name: 'Packing for a flight', revision: 3, created_at: '', updated_at: '', entries: [t('Documents'), t('Passport', 'Documents', 'Check expiry'), t('Sunscreen'), t('Keys')] };
const camping = { id: 'tpl-2', name: 'Weekend camping', revision: 1, created_at: '', updated_at: '', entries: [c('Tent'), c('Stove'), c('Gas'), c('Lighter'), c('Keys')] };
const edited = { 'tpl-1': 'Oct 12', 'tpl-2': 'Sep 2' };

beforeEach(() => {
  vi.resetAllMocks();
  list.mockResolvedValue({ ok: true, value: { templates: [flight, camping], edited } });
  snapshot.mockResolvedValue({ ok: true, value: tasks });
});
async function openPanel(projectName = 'US trip') {
  const user = userEvent.setup();
  render(<ProjectTasksSection projectId="source" projectName={projectName} />);
  await user.click(screen.getByRole('button', { name: 'Save as template' }));
  await waitFor(() => expect(screen.queryByText('Reading this project’s tasks…')).toBeNull());
  return user;
}
const submitButton = () => screen.getByRole('button', { name: /^(Save new template|Update template)/ });
const sentTitles = (call = 0) => update.mock.calls[call]![0].entries.map((e: { title: string }) => e.title);

describe('saving a new template', () => {
  it('with no templates yet, asks only for a name, submits once, and links to the new template', async () => {
    list.mockResolvedValue({ ok: true, value: { templates: [], edited: {} } });
    let resolve!: (value: unknown) => void;
    saveNew.mockReturnValue(new Promise(r => { resolve = r; }));
    const user = await openPanel('Finished trip');
    expect(screen.queryByRole('radio')).toBeNull();
    const name = screen.getByLabelText('Template name') as HTMLInputElement;
    expect(name.value).toBe('Finished trip');
    // Preselected, so a trip name is typed over with a reusable one.
    expect(document.activeElement).toBe(name);
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, name.value.length]);
    await user.clear(name);
    await user.type(name, 'Packing');
    const form = name.closest('form')!;
    await user.click(screen.getByRole('button', { name: 'Save new template · 5 tasks' }));
    fireEvent.submit(form);
    expect(saveNew).toHaveBeenCalledTimes(1);
    expect(saveNew).toHaveBeenCalledWith({ project_id: 'source', name: 'Packing' });
    resolve({ ok: true, value: { id: 'template-9', name: 'Packing' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved “Packing”. Your project is unchanged.'));
    expect(screen.getByRole('link', { name: 'Open template' }).getAttribute('href')).toBe('/task-templates/template-9');
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps the name on failure, and Cancel saves nothing', async () => {
    saveNew.mockResolvedValue({ ok: false, error: 'Could not save the template. Please try again.' });
    const user = await openPanel('Trip');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(saveNew).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Template name')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save as template' }));
    await user.click(await screen.findByRole('button', { name: /^Save new template/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save the template. Please try again.');
    expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('Trip');
    expect(submitButton().closest('fieldset')?.disabled).toBe(false);
  });

  it('defaults to a new template when no template shares the project name, and can still switch', async () => {
    saveNew.mockResolvedValue({ ok: true, value: { id: 'template-9', name: 'US trip' } });
    const user = await openPanel('US trip');
    expect((screen.getByRole('radio', { name: 'Save as a new template' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('Template to update')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Update an existing template' }));
    expect(screen.getByLabelText('Template to update')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Save as a new template' }));
    await user.click(submitButton());
    await waitFor(() => expect(saveNew).toHaveBeenCalledWith({ project_id: 'source', name: 'US trip' }));
  });

  it('says why a project cannot be saved and blocks the attempt', async () => {
    snapshot.mockResolvedValue({ ok: false, error: 'Add at least one task to this project before saving a template.' });
    await openPanel();
    expect(screen.getByRole('alert').textContent).toBe('Add at least one task to this project before saving a template.');
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    expect(submitButton().textContent).toBe('Save new template');
  });
});

describe('updating an existing template', () => {
  it('preselects the template that shares the project name and summarises the change', async () => {
    await openPanel('  packing for a FLIGHT ');
    expect((screen.getByRole('radio', { name: 'Update an existing template' }) as HTMLInputElement).checked).toBe(true);
    const target = screen.getByLabelText('Template to update') as HTMLSelectElement;
    expect(target.value).toBe('tpl-1');
    expect(document.activeElement).toBe(target);
    expect(within(target).getAllByRole('option').map(option => option.textContent)).toEqual(['Packing for a flight · 4 tasks · edited Oct 12', 'Weekend camping · 5 tasks · edited Sep 2']);
    const add = within(screen.getByRole('group', { name: 'Add to template · 2' }));
    expect(add.getAllByRole('checkbox').map(box => [(box as HTMLInputElement).checked, box.closest('label')!.textContent])).toEqual([[true, 'ESTA printout'], [true, 'Gift for Sam']]);
    const drop = within(screen.getByRole('group', { name: 'Remove from template · 1' }));
    expect(drop.getAllByRole('checkbox').map(box => [(box as HTMLInputElement).checked, box.closest('label')!.textContent])).toEqual([[true, 'Sunscreen']]);
    expect(screen.getByText('3 tasks unchanged')).toBeTruthy();
    expect(screen.getByText('This project stays as it is. Projects already made from the template keep their own tasks.')).toBeTruthy();
    expect(submitButton().textContent).toBe('Update template · 5 tasks');
  });

  it('lets one-off tasks stay behind and removed ones stay in, and saves exactly that', async () => {
    update.mockResolvedValue({ ok: true, value: { ...flight, revision: 4, entries: new Array(5).fill(t('x')) } });
    const user = await openPanel('Packing for a flight');
    await user.click(screen.getByRole('checkbox', { name: 'Gift for Sam' }));
    expect(submitButton().textContent).toBe('Update template · 4 tasks');
    await user.click(screen.getByRole('checkbox', { name: 'Sunscreen' }));
    expect(submitButton().textContent).toBe('Update template · 5 tasks');
    await user.click(submitButton());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toMatchObject({ id: 'tpl-1', revision: 3, name: 'Packing for a flight' });
    expect(sentTitles()).toEqual(['Documents', 'Passport', 'ESTA printout', 'Keys', 'Sunscreen']);
    // Matched entries keep the template's keys and notes; the added task sits under the template's parent.
    const [documents, passport, esta] = update.mock.calls[0]![0].entries;
    expect(documents.key).toBe('t:Documents');
    expect(passport).toMatchObject({ key: 't:Passport', notes: 'Check expiry', parent_key: 't:Documents' });
    expect(esta).toMatchObject({ key: 'p:ESTA printout', parent_key: 't:Documents' });
    expect(saveNew).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Updated “Packing for a flight” to 5 tasks. Your project is unchanged.'));
    expect(screen.getByRole('link', { name: 'Open template' }).getAttribute('href')).toBe('/task-templates/tpl-1');
  });

  it('warns when the project looks like a different list, and still allows the update', async () => {
    update.mockResolvedValue({ ok: true, value: { ...camping, entries: tasks } });
    const user = await openPanel('Packing for a flight');
    await user.selectOptions(screen.getByLabelText('Template to update'), 'tpl-2');
    expect(screen.getByText('Only 1 of this project’s 5 tasks is in “Weekend camping”. Updating would add 4 and remove 4. This looks like a different list; consider saving a new template.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(submitButton().textContent).toBe('Update template · 5 tasks');
    await user.click(submitButton());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toMatchObject({ id: 'tpl-2', revision: 1, name: 'Weekend camping' });
    expect(sentTitles()).toEqual(['Documents', 'Passport', 'ESTA printout', 'Keys', 'Gift for Sam']);
  });

  it('starts each template with a fresh set of choices', async () => {
    const user = await openPanel('Packing for a flight');
    await user.click(screen.getByRole('checkbox', { name: 'Gift for Sam' }));
    await user.selectOptions(screen.getByLabelText('Template to update'), 'tpl-2');
    await user.selectOptions(screen.getByLabelText('Template to update'), 'tpl-1');
    expect((screen.getByRole('checkbox', { name: 'Gift for Sam' }) as HTMLInputElement).checked).toBe(true);
  });

  it('after a conflict, shows the template as it now is and keeps the choices that still apply', async () => {
    const changed = { ...flight, revision: 4, entries: [t('Documents'), t('Passport', 'Documents', 'Check expiry'), t('Hat'), t('Keys')] };
    update.mockResolvedValueOnce({ ok: false, error: 'This template was saved in another window after you opened it. Your edits are still here.', currentRevision: 4 })
      .mockResolvedValueOnce({ ok: true, value: { ...changed, revision: 5 } });
    load.mockResolvedValue({ ok: true, value: changed });
    const user = await openPanel('Packing for a flight');
    await user.click(screen.getByRole('checkbox', { name: 'Gift for Sam' }));
    await user.click(screen.getByRole('checkbox', { name: 'Sunscreen' }));
    await user.click(submitButton());
    expect(await screen.findByText('“Packing for a flight” was changed in another window. The summary below is up to date; check it and update again.')).toBeTruthy();
    expect(load).toHaveBeenCalledWith('tpl-1');
    // Sunscreen is gone from the template, so that choice no longer exists; Hat is new there.
    expect(screen.queryByRole('checkbox', { name: 'Sunscreen' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Hat' }) as HTMLInputElement).checked).toBe(true);
    // The choice about a project task still applies.
    expect((screen.getByRole('checkbox', { name: 'Gift for Sam' }) as HTMLInputElement).checked).toBe(false);
    expect(submitButton().textContent).toBe('Update template · 4 tasks');
    await user.click(submitButton());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]![0]).toMatchObject({ id: 'tpl-1', revision: 4 });
    expect(sentTitles(1)).toEqual(['Documents', 'Passport', 'ESTA printout', 'Keys']);
  });

  it('falls back when the template was deleted meanwhile', async () => {
    update.mockResolvedValue({ ok: false, error: 'conflict', currentRevision: 9 });
    load.mockResolvedValue({ ok: false, error: 'This template is no longer available.' });
    const user = await openPanel('Packing for a flight');
    await user.click(submitButton());
    expect((await screen.findByRole('alert')).textContent).toBe('That template is no longer available. Choose another, or save a new template.');
    expect(within(screen.getByLabelText('Template to update')).getAllByRole('option').map(option => option.textContent)).toEqual(['Weekend camping · 5 tasks · edited Sep 2']);
  });

  it('refuses an update that would pass 200 tasks instead of truncating it', async () => {
    snapshot.mockResolvedValue({ ok: true, value: Array.from({ length: 200 }, (_, i) => p(i < 3 ? ['Documents', 'Sunscreen', 'Keys'][i]! : `Task ${i}`)) });
    const user = await openPanel('Packing for a flight');
    // 200 project tasks plus one template entry kept would make 201.
    await user.click(screen.getByRole('checkbox', { name: 'Passport' }));
    expect(submitButton().textContent).toBe('Update template · 201 tasks');
    await user.click(submitButton());
    expect(screen.getByRole('alert').textContent).toBe('The updated template would have 201 tasks. Templates hold up to 200; leave some out, or save a new template.');
    expect(update).not.toHaveBeenCalled();
  });

  it('still saves a new template when the templates cannot be listed', async () => {
    list.mockRejectedValue(new Error('offline'));
    await openPanel('Packing for a flight');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByLabelText('Template name')).toBeTruthy();
  });
});
