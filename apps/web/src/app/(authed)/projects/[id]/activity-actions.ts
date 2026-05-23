'use server';

import { revalidatePath } from 'next/cache';
import { projectsApi, ApiError } from '@/lib/api';

// Server actions for the per-project activity-log form. Adds a row +
// bumps projects.hours_logged on the API side. Delete also rolls back
// the hours_logged contribution so the rollup stays honest.

export type SaveResult = { ok: true } | { ok: false; error: string };

// Parse "1.5", "1h", "1h30m", "90m" — anything reasonable a human would
// type for an activity log. Empty or unparseable → null (no hours).
function parseHours(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // Bare number → straight hours.
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(s)) return parseFloat(s);
  // Hours + optional minutes ("1h30m", "1h", "2h 15m").
  const m = s.match(/^(?:([0-9]+(?:\.[0-9]+)?)\s*h)?\s*(?:([0-9]+)\s*m)?$/);
  if (m && (m[1] !== undefined || m[2] !== undefined)) {
    const h = m[1] ? parseFloat(m[1]) : 0;
    const min = m[2] ? parseInt(m[2], 10) : 0;
    return h + min / 60;
  }
  // Minutes-only ("45m", "30 min" — accept either).
  const minOnly = s.match(/^([0-9]+)\s*(?:m|min)$/);
  if (minOnly && minOnly[1]) return parseInt(minOnly[1], 10) / 60;
  return null;
}

export async function addActivityAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const projectId = String(formData.get('project_id') ?? '');
  const entry = String(formData.get('entry') ?? '').trim();
  const rawHours = String(formData.get('hours') ?? '').trim();
  if (!projectId) return { ok: false, error: 'Missing project id.' };
  if (!entry) return { ok: false, error: 'Describe what you did.' };
  const hours = parseHours(rawHours);
  if (rawHours && hours === null) {
    return { ok: false, error: 'Hours: use a number, "1h30m", or "45m".' };
  }
  try {
    await projectsApi.activity.add(projectId, { entry, hours });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string; details?: Record<string, string[]> } | null;
      return { ok: false, error: `API ${err.status} ${body?.error ?? ''}`.trim() };
    }
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  return { ok: true };
}

export async function deleteActivityAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('project_id') ?? '');
  const entryId = String(formData.get('entry_id') ?? '');
  if (!projectId || !entryId) return;
  try {
    await projectsApi.activity.remove(projectId, entryId);
  } catch {
    /* best-effort */
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
}
