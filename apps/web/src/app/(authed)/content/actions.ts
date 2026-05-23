'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { contentApi, ApiError, type ContentItem, type ContentItemStatus, type ContentItemType } from '@/lib/api';

export type SaveResult = { ok: true; id?: string } | { ok: false; error: string };

const VALID_STATUSES = ['idea', 'outline', 'filming', 'editing', 'published', 'derivatives_pending', 'done'] as const;
const VALID_TYPES = ['video', 'article', 'short_clip', 'podcast_episode', 'newsletter'] as const;

function readContentFields(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  const rawType = String(formData.get('type') ?? 'video');
  const type = (VALID_TYPES as readonly string[]).includes(rawType)
    ? (rawType as ContentItemType)
    : 'video';
  const rawStatus = String(formData.get('status') ?? 'idea');
  const status = (VALID_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as ContentItemStatus)
    : 'idea';
  const domain_id = String(formData.get('domain_id') ?? '').trim() || null;
  const outline_md = String(formData.get('outline_md') ?? '').trim() || null;
  const video_url = String(formData.get('video_url') ?? '').trim() || null;
  const article_url = String(formData.get('article_url') ?? '').trim() || null;
  const publishedRaw = String(formData.get('published_at') ?? '').trim();
  // Form gives YYYY-MM-DD; DB needs timestamptz. Pin to noon UTC to stay
  // on the chosen day regardless of viewer timezone.
  const published_at = publishedRaw ? `${publishedRaw}T12:00:00Z` : null;

  return { title, type, status, domain_id, outline_md, video_url, article_url, published_at };
}

export async function createContentAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const fields = readContentFields(formData);
  if (!fields.title) return { ok: false, error: 'Title is required.' };
  let created: ContentItem;
  try {
    created = await contentApi.create(fields);
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string; details?: Record<string, string[]> } | null;
      const detail = body?.details
        ? ` — ${Object.entries(body.details).map(([k, v]) => `${k}: ${v.join('|')}`).join('; ')}`
        : '';
      return { ok: false, error: `API ${err.status} ${body?.error ?? ''}${detail}`.trim() };
    }
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/content');
  redirect(`/content/${created.id}`);
}

export async function updateContentAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  const fields = readContentFields(formData);
  if (!fields.title) return { ok: false, error: 'Title is required.' };
  try {
    await contentApi.update(id, fields);
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string; details?: Record<string, string[]> } | null;
      const detail = body?.details
        ? ` — ${Object.entries(body.details).map(([k, v]) => `${k}: ${v.join('|')}`).join('; ')}`
        : '';
      return { ok: false, error: `API ${err.status} ${body?.error ?? ''}${detail}`.trim() };
    }
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath(`/content/${id}`);
  revalidatePath('/content');
  return { ok: true };
}

export async function deleteContentAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await contentApi.remove(id);
  } catch {
    /* best-effort */
  }
  revalidatePath('/content');
  redirect('/content');
}
