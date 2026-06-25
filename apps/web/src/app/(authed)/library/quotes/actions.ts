'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { libraryApi, ApiError, type Quote } from '@/lib/api';

export type SaveResult = { ok: true; id?: string } | { ok: false; error: string };

// Source types that the DB CHECK constraint actually accepts. We keep the
// list here in addition to the shared schema so a junk value in the form
// can't slip through into a query. Migration 0029 added 'sermon';
// migration 0030 added 'video'.
const VALID_SOURCE_TYPES = ['book', 'article', 'podcast', 'sermon', 'video', 'conversation', 'other'] as const;

// Pulls and normalizes the editable highlight fields from FormData.
// Empty strings become null so the DB stores null instead of empty text.
function readQuoteFields(formData: FormData) {
  const text = String(formData.get('text') ?? '').trim();
  const bookId = String(formData.get('book_id') ?? '').trim() || null;
  const sourceTypeRaw = String(formData.get('source_type') ?? '').trim();
  const source_type = (VALID_SOURCE_TYPES as readonly string[]).includes(sourceTypeRaw)
    ? (sourceTypeRaw as (typeof VALID_SOURCE_TYPES)[number])
    : null;
  const sourceAuthor = String(formData.get('source_author') ?? '').trim() || null;
  const sourceReference = String(formData.get('source_reference') ?? '').trim() || null;
  const sourceUrlRaw = String(formData.get('source_url') ?? '').trim();
  const pageRaw = String(formData.get('page_number') ?? '').trim();
  const page_number = pageRaw && /^\d+$/.test(pageRaw) ? parseInt(pageRaw, 10) : null;
  const chapter = String(formData.get('chapter') ?? '').trim() || null;
  const tagsRaw = String(formData.get('tags') ?? '').trim();
  const tags = tagsRaw
    ? tagsRaw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    text,
    book_id: bookId,
    source_type,
    source_author: sourceAuthor,
    source_reference: sourceReference,
    source_url: sourceUrlRaw, // validated in the action below
    page_number,
    chapter,
    tags,
  };
}

// Reject obviously malformed URLs at the action boundary so a junk value
// doesn't ever reach the DB. Empty string is fine — that becomes null.
function validateSourceUrl(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (!raw) return { ok: true, value: null };
  try {
    new URL(raw);
    return { ok: true, value: raw };
  } catch {
    return { ok: false, error: 'Source URL is not a valid URL.' };
  }
}

export async function createQuoteAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const fields = readQuoteFields(formData);
  if (!fields.text) return { ok: false, error: 'Text is required.' };
  const urlResult = validateSourceUrl(fields.source_url);
  if (!urlResult.ok) return { ok: false, error: urlResult.error };
  let created: Quote;
  try {
    created = await libraryApi.quotes.create({
      ...fields,
      source_url: urlResult.value,
      added_via: 'manual',
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/library/quotes');
  revalidatePath('/library');
  if (fields.book_id) revalidatePath(`/library/books/${fields.book_id}`);
  redirect(`/library/quotes/${created.id}`);
}

export async function updateQuoteAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  const fields = readQuoteFields(formData);
  if (!fields.text) return { ok: false, error: 'Text is required.' };
  const urlResult = validateSourceUrl(fields.source_url);
  if (!urlResult.ok) return { ok: false, error: urlResult.error };
  try {
    await libraryApi.quotes.update(id, {
      ...fields,
      source_url: urlResult.value,
    } as Partial<Quote>);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath(`/library/quotes/${id}`);
  revalidatePath('/library/quotes');
  revalidatePath('/library');
  if (fields.book_id) revalidatePath(`/library/books/${fields.book_id}`);
  return { ok: true };
}
