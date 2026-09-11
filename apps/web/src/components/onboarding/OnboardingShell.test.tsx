import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OnboardingModuleDefinition, OnboardingSession } from '@jevi-ops/shared/schemas';
import { OnboardingShell } from './OnboardingShell';

vi.mock('../../app/(authed)/onboarding/actions', () => ({
  saveOnboardingStepAction: vi.fn(), loadOnboardingAction: vi.fn(),
  completeOnboardingAction: vi.fn(), previewOnboardingAction: vi.fn(), transitionOnboardingAction: vi.fn(),
}));
import { saveOnboardingStepAction, loadOnboardingAction, previewOnboardingAction, transitionOnboardingAction } from '../../app/(authed)/onboarding/actions';
const saveMock = vi.mocked(saveOnboardingStepAction);
const loadMock = vi.mocked(loadOnboardingAction);
const previewMock = vi.mocked(previewOnboardingAction);
const transitionMock = vi.mocked(transitionOnboardingAction);

const module: OnboardingModuleDefinition = { id: 'vehicle', title: 'Vehicle', version: 1, entry_points: ['add_asset'],
  steps: [{ id: 'identity', title: 'Identity' }, { id: 'history', title: 'History', optional: true }] };
const session: OnboardingSession = {
  id: '11111111-1111-4111-8111-111111111111', owner_id: '22222222-2222-4222-8222-222222222222', creation_key: 'initial-key',
  module_id: 'vehicle', module_version: 1, subject_id: null, parent_session_id: null, status: 'in_progress', current_step_id: 'identity',
  step_states: { identity: 'draft', history: 'not_started' }, draft: { identity: { name: '' } }, revision: 0, preview: null,
  commit_operation_key: null, commit_receipt: null, created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z', completed_at: null,
};
function setup(initial = session) {
  return render(<OnboardingShell initialSession={initial} module={module} autosaveMs={100_000}
    renderStep={({ values, onChange }) => <label>Vehicle name<input value={String(values.name ?? '')} onChange={(e) => onChange({ ...values, name: e.target.value })} /></label>} />);
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('OnboardingShell', () => {
  it('preserves typing during autosave and flushes the newer snapshot against the returned revision', async () => {
    const first = deferred<Awaited<ReturnType<typeof saveOnboardingStepAction>>>();
    saveMock.mockReturnValueOnce(first.promise).mockImplementationOnce(async (input) => ({ ok: true, value: { ...session, revision: 2, draft: { identity: input.values } } }));
    setup();
    const box = screen.getByLabelText('Vehicle name') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Toyota' } });
    fireEvent.keyDown(box, { key: 's', metaKey: true });
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    fireEvent.change(box, { target: { value: 'Toyota Prado' } });
    first.resolve({ ok: true, value: { ...session, revision: 1, draft: { identity: { name: 'Toyota' } } } });
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    expect(saveMock.mock.calls[1]![0]).toMatchObject({ values: { name: 'Toyota Prado' }, expected_revision: 1 });
    expect(box.value).toBe('Toyota Prado');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
  });

  it('keeps failed answers and blocks leaving through a link or browser Back', async () => {
    saveMock.mockResolvedValue({ ok: false, error: 'connection_failed' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const push = vi.spyOn(window.history, 'pushState');
    setup();
    const box = screen.getByLabelText('Vehicle name') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Unsaved vehicle' } });
    fireEvent.keyDown(box, { key: 's', ctrlKey: true });
    await screen.findByRole('alert');
    expect(box.value).toBe('Unsaved vehicle');
    const link = document.createElement('a'); link.href = '/elsewhere'; document.body.appendChild(link);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(2);
    link.remove();
  });

  it('fetches current values on conflict and only rebases local input after the explicit choice', async () => {
    const latest = { ...session, revision: 5, draft: { identity: { name: 'Saved elsewhere' }, history: { coverage: 'complete' } } };
    saveMock.mockResolvedValueOnce({ ok: false, error: 'revision_conflict', session: { ...latest, revision: 4 } });
    loadMock.mockResolvedValue({ ok: true, value: { session: latest, module, warning: null } });
    setup();
    const box = screen.getByLabelText('Vehicle name') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Local name' } });
    fireEvent.keyDown(box, { key: 's', metaKey: true });
    await screen.findByRole('button', { name: 'Keep my step answers' });
    expect(box.value).toBe('Local name');
    expect(screen.getByText(/Saved elsewhere/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Keep my step answers' }));
    saveMock.mockResolvedValueOnce({ ok: true, value: { ...latest, revision: 6, draft: { ...latest.draft, identity: { name: 'Local name' } } } });
    fireEvent.keyDown(box, { key: 's', metaKey: true });
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    expect(saveMock.mock.calls[1]![0]).toMatchObject({ expected_revision: 5, values: { name: 'Local name' } });
    expect(box.value).toBe('Local name');
  });

  it('flushes input before preview, using the saved revision', async () => {
    const last = { ...session, current_step_id: 'history', draft: { history: { name: '' } } };
    saveMock.mockResolvedValue({ ok: true, value: { ...last, revision: 1, draft: { history: { name: 'No records supplied' } } } });
    previewMock.mockResolvedValue({ ok: true, value: { revision: 1, fingerprint: 'a'.repeat(64), changes: [], preconditions: {} } });
    setup(last);
    fireEvent.change(screen.getByLabelText('Vehicle name'), { target: { value: 'No records supplied' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await screen.findByRole('button', { name: 'Apply reviewed changes' });
    expect(previewMock).toHaveBeenCalledWith({ id: session.id, expected_revision: 1 });
    expect(saveMock.mock.invocationCallOrder[0]).toBeLessThan(previewMock.mock.invocationCallOrder[0]!);
  });

  it('defers only after saving and resumes the same saved answers', async () => {
    saveMock.mockResolvedValue({ ok: true, value: { ...session, revision: 1, draft: { identity: { name: 'Prado' } } } });
    transitionMock.mockResolvedValueOnce({ ok: true, value: { ...session, revision: 2, status: 'deferred', draft: { identity: { name: 'Prado' } } } });
    setup();
    fireEvent.change(screen.getByLabelText('Vehicle name'), { target: { value: 'Prado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and exit' }));
    await screen.findByRole('button', { name: 'Resume' });
    expect(transitionMock).toHaveBeenCalledWith({ id: session.id, expected_revision: 1, action: 'defer' });
    transitionMock.mockResolvedValueOnce({ ok: true, value: { ...session, revision: 3, draft: { identity: { name: 'Prado' } } } });
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect((await screen.findByLabelText('Vehicle name') as HTMLInputElement).value).toBe('Prado');
  });
});
