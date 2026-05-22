'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { libraryApi, ApiError } from '@/lib/api';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addAnnotationAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const quoteId = String(formData.get('quoteId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (!quoteId || !body) return { ok: false, error: 'Body is required.' };
  try {
    await libraryApi.annotations.create(quoteId, body);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath(`/library/quotes/${quoteId}`);
  revalidatePath('/library');
  return { ok: true };
}

export async function deleteAnnotationAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const quoteId = String(formData.get('quoteId') ?? '');
  if (!id) return;
  try {
    await libraryApi.annotations.remove(id);
  } catch {
    /* best-effort */
  }
  if (quoteId) revalidatePath(`/library/quotes/${quoteId}`);
  revalidatePath('/library');
}

export async function deleteQuoteAction(formData: FormData): Promise<void> {
  const quoteId = String(formData.get('quoteId') ?? '');
  if (!quoteId) return;
  try {
    await libraryApi.quotes.remove(quoteId);
  } catch {
    /* best-effort */
  }
  revalidatePath('/library/quotes');
  revalidatePath('/library');
  redirect('/library/quotes');
}
