import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changePasswordAction } from './password-actions';

const mock = vi.hoisted(() => ({
  requireUser: vi.fn(), changePassword: vi.fn(),
  ApiError: class extends Error { constructor(public status: number, public body: unknown) { super('API failed'); } },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mock.requireUser }));
vi.mock('@/lib/api', () => ({ authApi: { changePassword: mock.changePassword }, ApiError: mock.ApiError }));
beforeEach(() => { vi.resetAllMocks(); mock.requireUser.mockResolvedValue({ id: 'test-user', email: 'owner@test.local' }); });

function form() {
  const data = new FormData();
  data.set('current_password', ' current password ');
  data.set('new_password', ' new password value ');
  data.set('confirm_password', ' new password value ');
  return data;
}

describe('password server action', () => {
  it('requires a session before calling the API', async () => {
    mock.requireUser.mockRejectedValue(new Error('redirect-sign-in'));
    await expect(changePasswordAction(form())).rejects.toThrow('redirect-sign-in');
    expect(mock.changePassword).not.toHaveBeenCalled();
  });
  it('validates confirmation on the server too', async () => {
    const data = form(); data.set('confirm_password', 'different password');
    expect(await changePasswordAction(data)).toMatchObject({ ok: false, message: 'New passwords do not match.' });
    expect(mock.changePassword).not.toHaveBeenCalled();
  });
  it('preserves exact password values and returns no credential data', async () => {
    const result = await changePasswordAction(form());
    expect(mock.changePassword).toHaveBeenCalledWith({ current_password: ' current password ', new_password: ' new password value ', confirm_password: ' new password value ' });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('password value');
  });
  it.each([
    [400, 'invalid_current_password', 'Current password is incorrect.'],
    [401, 'invalid_session', 'Sign in again'],
    [403, 'session_required', 'Sign in again'],
    [429, 'too_many_attempts', 'Wait a minute'],
    [409, 'password_changed', 'another request'],
  ])('maps API %s/%s to actionable feedback', async (status, error, message) => {
    mock.changePassword.mockRejectedValue(new mock.ApiError(status as number, { error }));
    expect(await changePasswordAction(form())).toMatchObject({ ok: false, message: expect.stringContaining(message as string) });
  });
  it('does not expose raw errors or response bodies', async () => {
    mock.changePassword.mockRejectedValue(new mock.ApiError(500, { private_value: 'secret-detail' }));
    const result = await changePasswordAction(form());
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret-detail');
  });
});
