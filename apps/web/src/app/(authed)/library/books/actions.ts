'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { libraryApi, ApiError, type Book } from '@/lib/api';

export type SaveResult = { ok: true; id?: string } | { ok: false; error: string };

const VALID_STATUSES = ['reading', 'finished', 'abandoned', 'want_to_read'] as const;
const VALID_FORMATS = ['physical', 'kindle', 'audiobook'] as const;

// Pulls and normalizes the common book fields from FormData. Empty strings
// become null so the DB stores null rather than blank text.
function readBookFields(formData: FormData): Partial<Book> & { title: string } {
  const title = String(formData.get('title') ?? '').trim();
  const author = String(formData.get('author') ?? '').trim() || null;
  const isbn = String(formData.get('isbn') ?? '').trim() || null;
  const coverUrl = String(formData.get('cover_image_url') ?? '').trim() || null;
  const rawStatus = String(formData.get('status') ?? 'want_to_read');
  const status = (VALID_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as Book['status'])
    : 'want_to_read';
  const rawFormat = String(formData.get('format') ?? '');
  const format = (VALID_FORMATS as readonly string[]).includes(rawFormat)
    ? (rawFormat as Book['format'])
    : null;
  const startedAt = String(formData.get('started_at') ?? '').trim() || null;
  const finishedAt = String(formData.get('finished_at') ?? '').trim() || null;
  const ratingRaw = String(formData.get('rating') ?? '').trim();
  const rating = ratingRaw && /^[1-5]$/.test(ratingRaw) ? parseInt(ratingRaw, 10) : null;
  const summary = String(formData.get('my_summary') ?? '').trim() || null;

  return {
    title,
    author,
    isbn,
    cover_image_url: coverUrl,
    status,
    format,
    started_at: startedAt,
    finished_at: finishedAt,
    rating,
    my_summary: summary,
  };
}

export async function createBookAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const fields = readBookFields(formData);
  if (!fields.title) return { ok: false, error: 'Title is required.' };
  let created: Book;
  try {
    created = await libraryApi.books.create(fields);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/library/books');
  revalidatePath('/library');
  redirect(`/library/books/${created.id}`);
}

export async function updateBookAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  const fields = readBookFields(formData);
  if (!fields.title) return { ok: false, error: 'Title is required.' };
  try {
    await libraryApi.books.update(id, fields);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath(`/library/books/${id}`);
  revalidatePath('/library/books');
  revalidatePath('/library');
  return { ok: true };
}

export async function deleteBookAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await libraryApi.books.remove(id);
  } catch {
    /* best-effort */
  }
  revalidatePath('/library/books');
  revalidatePath('/library');
  redirect('/library/books');
}
