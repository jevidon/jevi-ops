'use server';

import { revalidatePath } from 'next/cache';
import { projectsApi, ApiError } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';

// Server actions for the per-project activity-log form. Adds a row +
// bumps projects.hours_logged on the API side. Delete rolls back the
// hours contribution; update applies the delta so the rollup stays
// honest as you edit.

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

// HTML <input type="datetime-local"> hands us a value like
// "2025-05-23T14:30" with no timezone — the user means "that wall-clock
// time in MY zone." Returns a UTC ISO string the API stores as
// timestamptz, or null if the input is blank/garbage.
function localInputToUtcIso(raw: string, tz: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // Accept "YYYY-MM-DDTHH:mm" or with seconds; reject anything else.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  // We figure out the UTC instant by computing the offset between
  // (the input components interpreted as UTC) and (what `tz` sees of
  // that instant). The difference is the offset to apply.
  const asUtc = new Date(`${s}${s.length === 16 ? ':00' : ''}Z`);
  if (Number.isNaN(asUtc.getTime())) return null;

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(asUtc).map((p) => [p.type, p.value]),
  );
  const tzView = Date.UTC(
    parseInt(parts.year!, 10),
    parseInt(parts.month!, 10) - 1,
    parseInt(parts.day!, 10),
    parseInt(parts.hour === '24' ? '0' : parts.hour!, 10),
    parseInt(parts.minute!, 10),
    parseInt(parts.second!, 10),
  );
  const offsetMs = asUtc.getTime() - tzView;
  return new Date(asUtc.getTime() + offsetMs).toISOString();
}

export async function addActivityAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const projectId = String(formData.get('project_id') ?? '');
  const entry = String(formData.get('entry') ?? '').trim();
  const rawHours = String(formData.get('hours') ?? '').trim();
  const rawWhen = String(formData.get('logged_at') ?? '').trim();
  const rawKind = String(formData.get('kind') ?? 'work').trim();
  const kind: 'work' | 'update' = rawKind === 'update' ? 'update' : 'work';
  if (!projectId) return { ok: false, error: 'Missing project id.' };
  if (!entry) return { ok: false, error: 'Describe what happened.' };
  // Hours only count on Work entries — Update entries have no hours
  // field in the UI but defensively ignore anything sent.
  const hours = kind === 'work' ? parseHours(rawHours) : null;
  if (kind === 'work' && rawHours && hours === null) {
    return { ok: false, error: 'Hours: use a number, "1h30m", or "45m".' };
  }
  // Optional backfill timestamp. Blank means "use now" (server default).
  const loggedAt = rawWhen ? localInputToUtcIso(rawWhen, await getAppTimezone()) : null;
  if (rawWhen && !loggedAt) {
    return { ok: false, error: 'When: invalid date/time.' };
  }
  try {
    await projectsApi.activity.add(projectId, {
      entry,
      hours,
      kind,
      ...(loggedAt ? { logged_at: loggedAt } : {}),
    });
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

export async function updateActivityAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const projectId = String(formData.get('project_id') ?? '');
  const entryId = String(formData.get('entry_id') ?? '');
  const entry = String(formData.get('entry') ?? '').trim();
  const rawHours = String(formData.get('hours') ?? '').trim();
  const rawWhen = String(formData.get('logged_at') ?? '').trim();
  if (!projectId || !entryId) return { ok: false, error: 'Missing ids.' };
  if (!entry) return { ok: false, error: 'Describe what you did.' };

  // hours: empty → clear (null), value → parsed number. Distinguishing
  // "no change" from "clear" matters here because the API treats `null`
  // as "set to 0 and recalc the project total". The form always sends
  // the field (even if empty), so this is "clear" when empty.
  const hours = parseHours(rawHours);
  if (rawHours && hours === null) {
    return { ok: false, error: 'Hours: use a number, "1h30m", or "45m".' };
  }
  const loggedAt = rawWhen ? localInputToUtcIso(rawWhen, await getAppTimezone()) : null;
  if (rawWhen && !loggedAt) {
    return { ok: false, error: 'When: invalid date/time.' };
  }

  const body: { entry: string; hours: number | null; logged_at?: string } = {
    entry,
    hours: rawHours ? hours : null,
  };
  if (loggedAt) body.logged_at = loggedAt;

  try {
    await projectsApi.activity.update(projectId, entryId, body);
  } catch (err) {
    if (err instanceof ApiError) {
      const apiBody = err.body as { error?: string; details?: Record<string, string[]> } | null;
      return { ok: false, error: `API ${err.status} ${apiBody?.error ?? ''}`.trim() };
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
