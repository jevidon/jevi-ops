import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectTasksSection } from './project-tasks-section';

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../../task-templates/actions', () => ({ saveProjectAsTemplate: save }));
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

it('names a project template, submits once, and shows a link without leaving the project', async () => {
  const user = userEvent.setup();
  let resolve!: (value: unknown) => void;
  save.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<ProjectTasksSection projectId="source" projectName="Finished trip" />);
  await user.click(screen.getByRole('button', { name: 'Save as template' }));
  const name = screen.getByLabelText('Template name') as HTMLInputElement;
  expect(name.value).toBe('Finished trip');
  expect(name.selectionStart).toBe(0);
  expect(name.selectionEnd).toBe(name.value.length);
  await user.clear(name);
  await user.type(name, 'Packing');
  const form = name.closest('form')!;
  await user.click(screen.getByRole('button', { name: 'Save template' }));
  fireEvent.submit(form);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith({ project_id: 'source', name: 'Packing' });
  resolve({ ok: true, value: { id: 'template-9', name: 'Packing' } });
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Your project is unchanged'));
  expect(screen.getByRole('link', { name: 'Open template' }).getAttribute('href')).toBe('/task-templates/template-9');
});

it('retains the name on failure and cancel does not save anything', async () => {
  const user = userEvent.setup();
  save.mockResolvedValue({ ok: false, error: 'Add at least one task.' });
  render(<ProjectTasksSection projectId="source" projectName="Trip" />);
  await user.click(screen.getByRole('button', { name: 'Save as template' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save as template' }));
  await user.click(screen.getByRole('button', { name: 'Save template' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('Trip');
  expect(screen.getByRole('button', { name: 'Save template' }).closest('fieldset')?.disabled).toBe(false);
});
