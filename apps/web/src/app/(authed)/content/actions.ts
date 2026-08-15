'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { contentApi, ApiError, type ContentItem, type ContentItemStatus, type ContentItemType } from '@/lib/api';

export type SaveResult = { ok: true; id?: string } | { ok: false; error: string };

const VALID_STATUSES = ['idea', 'outline', 'filming', 'editing', 'published', 'derivatives_pending', 'done'] as const;
const VALID_TYPES = ['video', 'article', 'short_clip', 'podcast_episode', 'newsletter', 'course'] as const;
const VALID_PLATFORMS = ['yt_shorts', 'ig_reels', 'fb_reels', 'tiktok', 'threads', 'x'] as const;

// Per-type conditional fields (Addendum 07): the form renders only the current
// type's fields, so a field ABSENT from FormData must be left untouched — we
// include it in the payload only when it's actually present. The PATCH is
// partial, so omitted fields keep their stored values.
type ContentFields = { title: string; type: ContentItemType; status: ContentItemStatus } & Record<string, unknown>;

function readContentFields(formData: FormData): ContentFields {
  const rawType = String(formData.get('type') ?? 'video');
  const type = (VALID_TYPES as readonly string[]).includes(rawType) ? (rawType as ContentItemType) : 'video';
  const rawStatus = String(formData.get('status') ?? 'idea');
  const status = (VALID_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as ContentItemStatus) : 'idea';

  const fields: ContentFields = {
    title: String(formData.get('title') ?? '').trim(),
    type,
    status,
    domain_id: String(formData.get('domain_id') ?? '').trim() || null,
  };

  // Conditionally-rendered text/date fields: include only if present.
  for (const key of ['outline_md', 'video_url', 'article_url', 'canonical_url', 'body_rich', 'produced_on', 'target_publish_date']) {
    if (formData.has(key)) fields[key] = String(formData.get(key) ?? '').trim() || null;
  }

  // published_at stays timestamptz — pin to noon UTC so the day doesn't drift.
  if (formData.has('published_at')) {
    const raw = String(formData.get('published_at') ?? '').trim();
    fields.published_at = raw ? `${raw}T12:00:00Z` : null;
  }

  // platforms[] — only when the short-clip group rendered (marker input).
  if (formData.get('_has_platforms')) {
    const picked = formData.getAll('platforms').map(String).filter((p) => (VALID_PLATFORMS as readonly string[]).includes(p));
    fields.platforms = picked.length ? picked : null;
  }

  // meta jsonb — only when a meta group rendered. Numeric-looking *_number
  // values become numbers so they can be filtered later.
  if (formData.get('_has_meta')) {
    const meta: Record<string, unknown> = {};
    for (const [k, v] of formData.entries()) {
      if (!k.startsWith('meta_')) continue;
      const val = String(v).trim();
      if (!val) continue;
      const key = k.slice('meta_'.length);
      meta[key] = key.endsWith('_number') && /^\d+$/.test(val) ? Number(val) : val;
    }
    fields.meta = meta;
  }

  return fields;
}

export async function createContentAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const fields = readContentFields(formData);
  if (!fields.title) return { ok: false, error: 'Title is required.' };
  let created: ContentItem;
  try {
    created = await contentApi.create(fields as Partial<ContentItem> & { title: string });
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
    await contentApi.update(id, fields as Partial<ContentItem>);
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

// ─── Checklist actions ────────────────────────────────────────────────

export async function toggleChecklistItemAction(formData: FormData): Promise<void> {
  const contentId = String(formData.get('contentId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  const done = formData.get('done') === 'true';
  if (!contentId || !itemId) return;
  try {
    await contentApi.checklist.update(contentId, itemId, { done });
  } catch {
    /* best-effort */
  }
  revalidatePath(`/content/${contentId}`);
}

export async function addChecklistItemAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const contentId = String(formData.get('contentId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (!contentId) return { ok: false, error: 'Missing content id.' };
  if (!title) return { ok: false, error: 'Title required.' };
  try {
    await contentApi.checklist.add(contentId, { title });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath(`/content/${contentId}`);
  return { ok: true };
}

export async function deleteChecklistItemAction(formData: FormData): Promise<void> {
  const contentId = String(formData.get('contentId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  if (!contentId || !itemId) return;
  try {
    await contentApi.checklist.remove(contentId, itemId);
  } catch {
    /* best-effort */
  }
  revalidatePath(`/content/${contentId}`);
}

export async function seedDefaultsAction(formData: FormData): Promise<void> {
  const contentId = String(formData.get('contentId') ?? '');
  if (!contentId) return;
  try {
    await contentApi.checklist.seedDefaults(contentId);
  } catch {
    /* best-effort */
  }
  revalidatePath(`/content/${contentId}`);
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

// ─── Idea triage (Addendum 09 §5) ────────────────────────────────────────
//
// The Sunday idea strip died with the recap page; its Keep/Archive semantics
// live here instead, on the ideas-filtered index. Keep stamps idea_reviewed_at
// (resetting the aging clock the ideas_aging attention rule reads); Archive
// stamps archived_at, which drops the item from the index, the Work page's
// Ideas (N), and the rule. Both revalidate /work so the count stays honest.

export async function keepIdeaAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await contentApi.update(id, { idea_reviewed_at: new Date().toISOString() });
  } catch {
    /* best-effort; revalidate resyncs */
  }
  revalidatePath('/content');
  revalidatePath('/work');
  revalidatePath('/attention');
}

export async function archiveIdeaAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await contentApi.update(id, { archived_at: new Date().toISOString() });
  } catch {
    /* best-effort */
  }
  revalidatePath('/content');
  revalidatePath('/work');
  revalidatePath('/attention');
}

// Holder flip on the Content page (v2) — same one-tap unconstrained flip the
// Work page has (Addendum 08). The API stamps holder_since on a real transition
// into editing; revalidate both surfaces so aging + Work's editor state resync.
export async function flipHolderAction(id: string, next: 'me' | 'editor'): Promise<void> {
  try {
    await contentApi.update(id, { holder: next });
  } catch {
    /* best-effort */
  }
  revalidatePath('/content');
  revalidatePath('/work');
}

// The my-move primary button on the Content detail page (Addendum 10 §7):
// advance the pipeline one step (idea→outline→filming→editing→published, and
// derivatives_pending→done). The verb is computed from status; this just moves
// it. Best-effort; the page reloads to the new state.
export async function advanceStatusAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const next = String(formData.get('next') ?? '');
  if (!id || !(VALID_STATUSES as readonly string[]).includes(next)) return;
  try {
    await contentApi.update(id, { status: next as ContentItemStatus });
  } catch {
    /* best-effort */
  }
  revalidatePath(`/content/${id}`);
  revalidatePath('/content');
  revalidatePath('/work');
  revalidatePath('/today');
}
