'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { projectsApi, ApiError, type ProjectCreate, type ProjectUpdate } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const VALID_TYPES = ['client', 'internal', 'content'] as const;
const VALID_STATUSES = ['active', 'paused', 'done', 'archived'] as const;

function readFields(formData: FormData): {
  name: string;
  description: string | null;
  domain_id: string | null;
  type: 'client' | 'internal' | 'content' | null;
  status: 'active' | 'paused' | 'done' | 'archived' | null;
  quoted_hours: number | null;
  start_date: string | null;
  target_date: string | null;
  color: string | null;
} {
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  const domain_id = String(formData.get('domain_id') ?? '').trim() || null;
  const rawType = String(formData.get('type') ?? '').trim();
  const type = (VALID_TYPES as readonly string[]).includes(rawType)
    ? (rawType as 'client' | 'internal' | 'content')
    : null;
  const rawStatus = String(formData.get('status') ?? '').trim();
  const status = (VALID_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as 'active' | 'paused' | 'done' | 'archived')
    : null;
  const quotedRaw = String(formData.get('quoted_hours') ?? '').trim();
  const quoted_hours = quotedRaw && !Number.isNaN(parseFloat(quotedRaw))
    ? parseFloat(quotedRaw)
    : null;
  const start_date = String(formData.get('start_date') ?? '').trim() || null;
  const target_date = String(formData.get('target_date') ?? '').trim() || null;
  const color = String(formData.get('color') ?? '').trim() || null;

  return { name, description, domain_id, type, status, quoted_hours, start_date, target_date, color };
}

export async function createProjectAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const fields = readFields(formData);
  if (!fields.name) return { ok: false, error: 'Name is required.' };
  // Status only applies on update; create defaults to 'active' via DB.
  const payload: ProjectCreate = {
    name: fields.name,
    description: fields.description,
    domain_id: fields.domain_id,
    type: fields.type,
    quoted_hours: fields.quoted_hours,
    start_date: fields.start_date,
    target_date: fields.target_date,
    color: fields.color,
  };
  let created;
  try {
    created = await projectsApi.create(payload);
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
  revalidatePath('/projects');
  revalidatePath('/today');
  redirect(`/projects/${created.id}`);
}

export async function updateProjectAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  const fields = readFields(formData);
  if (!fields.name) return { ok: false, error: 'Name is required.' };
  const payload: ProjectUpdate = {
    name: fields.name,
    description: fields.description,
    domain_id: fields.domain_id,
    type: fields.type,
    quoted_hours: fields.quoted_hours,
    start_date: fields.start_date,
    target_date: fields.target_date,
    color: fields.color,
  };
  if (fields.status) payload.status = fields.status;
  try {
    await projectsApi.update(id, payload);
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
  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');
  revalidatePath('/today');
  revalidatePath('/tasks');
  return { ok: true };
}

export async function deleteProjectAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await projectsApi.remove(id);
  } catch {
    /* best-effort */
  }
  revalidatePath('/projects');
  revalidatePath('/today');
  revalidatePath('/tasks');
  redirect('/projects');
}
