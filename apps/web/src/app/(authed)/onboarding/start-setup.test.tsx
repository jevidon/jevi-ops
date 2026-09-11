import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OnboardingSession } from '@jevi-ops/shared/schemas';
import { StartSetup } from './start-setup';
import { startOnboardingAction } from './actions';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('./actions', () => ({ startOnboardingAction: vi.fn() }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('starts setup without native randomUUID and reuses the creation key after a connection failure', async () => {
  vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  const session: OnboardingSession = {
    id: '11111111-1111-4111-8111-111111111111', owner_id: '22222222-2222-4222-8222-222222222222', creation_key: 'unused',
    module_id: 'core', module_version: 1, subject_id: null, parent_session_id: null, status: 'in_progress', current_step_id: 'welcome',
    step_states: {}, draft: {}, revision: 0, preview: null, commit_operation_key: null, commit_receipt: null,
    created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z', completed_at: null,
  };
  const start = vi.mocked(startOnboardingAction);
  start.mockResolvedValueOnce({ ok: false, error: 'connection_failed' }).mockResolvedValueOnce({ ok: true, value: session });
  render(<StartSetup moduleId="core" title="Start setup" firstRun />);

  fireEvent.click(screen.getByRole('button', { name: 'Start setup' }));
  expect((await screen.findByRole('alert')).textContent).toBe('connection failed');
  const button = screen.getByRole('button', { name: 'Start setup' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(button);

  await waitFor(() => expect(push).toHaveBeenCalledWith(`/onboarding/${session.id}`));
  expect(start).toHaveBeenCalledTimes(2);
  expect(start.mock.calls[0]![0]).toEqual({ module_id: 'core', entry_point: 'first_run',
    creation_key: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) });
  expect(start.mock.calls[1]![0]).toEqual(start.mock.calls[0]![0]);
});
