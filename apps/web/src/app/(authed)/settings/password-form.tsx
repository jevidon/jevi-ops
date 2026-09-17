'use client';

import { useRef, useState } from 'react';
import { ChangePasswordSchema, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@jevi-ops/shared';
import { changePasswordAction, type PasswordResult } from './password-actions';

export function PasswordForm({ email }: { email: string }) {
  const [result, setResult] = useState<PasswordResult | null>(null);
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);
  const submitting = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = ChangePasswordSchema.safeParse({
      current_password: data.get('current_password'),
      new_password: data.get('new_password'),
      confirm_password: data.get('confirm_password'),
    });
    if (!parsed.success) {
      setResult({ ok: false, message: parsed.error.issues[0]?.message ?? 'Check the password fields.' });
      return;
    }
    submitting.current = true;
    setPending(true);
    setResult(null);
    try {
      const next = await changePasswordAction(data);
      setResult(next);
      if (next.ok) {
        form.reset();
        setVisible(false);
      }
    } catch {
      setResult({ ok: false, message: 'Could not confirm the password change. Check your connection before trying again.' });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 max-w-sm">
      <p className="text-[13px] text-ink-2">Change the sign-in password for {email}.</p>
      <input type="hidden" name="username" autoComplete="username" value={email} />
      <fieldset disabled={pending} className="flex flex-col gap-3">
        {[
          ['current_password', 'Current password', 'current-password'],
          ['new_password', 'New password', 'new-password'],
          ['confirm_password', 'Confirm new password', 'new-password'],
        ].map(([name, label, autoComplete]) => (
          <label key={name} className="flex flex-col gap-1">
            <span className="eyebrow">{label}</span>
            <input name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete}
              required minLength={name === 'current_password' ? 1 : MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH} autoCapitalize="none" autoCorrect="off" spellCheck={false}
              aria-describedby="password-help"
              className="rounded border border-line bg-bg px-3 py-2 text-[14px] text-ink" />
          </label>
        ))}
        <p id="password-help" className="text-[12px] text-ink-3">Use at least {MIN_PASSWORD_LENGTH} characters. Spaces count as password characters.</p>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
          Show passwords
        </label>
        <button type="submit" className="self-start rounded bg-ink px-4 py-2 text-[13px] text-bg disabled:opacity-50">
          {pending ? 'Changing…' : 'Change password'}
        </button>
      </fieldset>
      <p className="text-[12px] text-ink-3">Existing sessions and API tokens stay active. Revoke agent or device tokens in the API tokens section below.</p>
      {result && <p role={result.ok ? 'status' : 'alert'} className={`text-[13px] ${result.ok ? 'text-ink-2' : 'text-accent'}`}>{result.message}</p>}
    </form>
  );
}
