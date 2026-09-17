'use server';

import { ChangePasswordSchema } from '@jevi-ops/shared';
import { authApi, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export interface PasswordResult { ok: boolean; message: string }

export async function changePasswordAction(formData: FormData): Promise<PasswordResult> {
  await requireUser();
  const parsed = ChangePasswordSchema.safeParse({
    current_password: formData.get('current_password'),
    new_password: formData.get('new_password'),
    confirm_password: formData.get('confirm_password'),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the password fields.' };

  try {
    await authApi.changePassword(parsed.data);
    return { ok: true, message: 'Password changed. Use your new password the next time you sign in.' };
  } catch (error) {
    if (error instanceof ApiError) {
      const code = (error.body as { error?: string } | null)?.error;
      if (code === 'invalid_current_password') return { ok: false, message: 'Current password is incorrect.' };
      if (error.status === 401 || error.status === 403) return { ok: false, message: 'Sign in again before changing your password.' };
      if (error.status === 429) return { ok: false, message: 'Too many attempts. Wait a minute before trying again.' };
      if (error.status === 409) return { ok: false, message: 'Your password changed in another request. Try again with the current password.' };
      if (error.status === 400) return { ok: false, message: 'Check the password fields and try again.' };
    }
    // Never return submitted passwords, response bodies, or raw exceptions.
    return { ok: false, message: 'Could not confirm the password change. Check your connection; if it was saved, use the new password to sign in.' };
  }
}
