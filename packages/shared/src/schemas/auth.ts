import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

// Passwords are opaque: preserve whitespace and Unicode exactly.
export const ChangePasswordSchema = z.object({
  current_password: z.string().min(1, 'Enter your current password.').max(MAX_PASSWORD_LENGTH),
  new_password: z.string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`)
    .max(MAX_PASSWORD_LENGTH, `Use no more than ${MAX_PASSWORD_LENGTH} characters for the new password.`),
  confirm_password: z.string().max(MAX_PASSWORD_LENGTH),
}).strict().refine((value) => value.new_password === value.confirm_password, {
  path: ['confirm_password'], message: 'New passwords do not match.',
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
