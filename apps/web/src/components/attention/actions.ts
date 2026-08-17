'use server';

import { revalidatePath } from 'next/cache';
import { attentionApi } from '@/lib/api';

// Lifecycle server actions for Attention items. Each revalidates both the
// Today card and the full feed so the item moves/disappears immediately.

function revalidate() {
  revalidatePath('/');
  revalidatePath('/attention');
}

export async function snoozeAttentionAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const until = String(formData.get('until') ?? '').trim() || undefined;
  try {
    await attentionApi.act(id, { action: 'snooze', ...(until ? { until } : {}) });
  } catch {
    /* best-effort; revalidate resyncs */
  }
  revalidate();
}

export async function dismissAttentionAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await attentionApi.act(id, { action: 'dismiss' });
  } catch {
    /* best-effort */
  }
  revalidate();
}

export async function actedAttentionAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const note = String(formData.get('acted_on_action') ?? '').trim() || undefined;
  try {
    await attentionApi.act(id, { action: 'acted_on', ...(note ? { acted_on_action: note } : {}) });
  } catch {
    /* best-effort */
  }
  revalidate();
}
