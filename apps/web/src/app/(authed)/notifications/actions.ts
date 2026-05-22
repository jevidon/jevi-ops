'use server';

import { revalidatePath } from 'next/cache';
import { notificationsApi } from '@/lib/api';

export async function markNotificationStatusAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || (status !== 'read' && status !== 'unread' && status !== 'dismissed')) return;
  try {
    await notificationsApi.patch(id, status);
  } catch {
    /* best-effort */
  }
  revalidatePath('/notifications');
  revalidatePath('/today');
}

export async function markAllReadAction(): Promise<void> {
  try {
    await notificationsApi.markAllRead();
  } catch {
    /* best-effort */
  }
  revalidatePath('/notifications');
  revalidatePath('/today');
}
