import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PasswordForm } from './password-form';
import { changePasswordAction } from './password-actions';

vi.mock('./password-actions', () => ({ changePasswordAction: vi.fn() }));
const changePassword = vi.mocked(changePasswordAction);
beforeEach(() => { changePassword.mockReset(); });
afterEach(cleanup);

function fill() {
  render(<PasswordForm email="owner@test.local" />);
  const fields = ['Current password', 'New password', 'Confirm new password'].map((name) => screen.getByLabelText(name) as HTMLInputElement);
  ['current password', 'new password value', 'new password value'].forEach((value, index) => fireEvent.change(fields[index]!, { target: { value } }));
  return { fields, form: fields[0]!.closest('form')! };
}

describe('Settings password form', () => {
  it('blocks mismatched confirmation before sending a request', async () => {
    const { fields, form } = fill();
    fireEvent.change(fields[2]!, { target: { value: 'different password' } });
    fireEvent.submit(form);
    expect(screen.getByRole('alert').textContent).toContain('do not match');
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('preserves password text and clears all fields after success', async () => {
    changePassword.mockResolvedValue({ ok: true, message: 'Password changed.' });
    const { fields, form } = fill();
    fireEvent.change(fields[0]!, { target: { value: ' current password ' } });
    fireEvent.click(screen.getByLabelText('Show passwords'));
    expect(fields[0]!.type).toBe('text');
    fireEvent.submit(form);
    await screen.findByRole('status');
    expect(changePassword.mock.calls[0]![0].get('current_password')).toBe(' current password ');
    for (const field of fields) { expect(field.value).toBe(''); expect(field.type).toBe('password'); }
  });

  it('keeps values for correction and displays the server error', async () => {
    changePassword.mockResolvedValue({ ok: false, message: 'Current password is incorrect.' });
    const { fields, form } = fill();
    fireEvent.submit(form);
    expect((await screen.findByRole('alert')).textContent).toContain('Current password is incorrect');
    expect(fields[1]!.value).toBe('new password value');
  });

  it('prevents duplicate submissions and editing while the request is pending', async () => {
    let resolve!: (value: { ok: boolean; message: string }) => void;
    changePassword.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { fields, form } = fill();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(changePassword).toHaveBeenCalledTimes(1);
    expect(fields[0]!.closest('fieldset')!.disabled).toBe(true);
    resolve({ ok: true, message: 'Password changed.' });
    await waitFor(() => expect(fields[0]!.closest('fieldset')!.disabled).toBe(false));
  });

  it('handles a lost response without claiming that the password was unchanged', async () => {
    changePassword.mockRejectedValue(new Error('transport failed'));
    const { form } = fill();
    fireEvent.submit(form);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not confirm');
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDefined();
  });
});
