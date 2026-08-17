'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { tasksApi, observationsApi, conversationsApi, ApiError } from '@/lib/api';
import { todayIsoDate } from '@/lib/today';
import { getAppTimezone } from '@/lib/app-settings';

const CreateTaskFormSchema = z.object({
  title: z.string().trim().min(1),
});

export async function createTaskAction(_prev: { error?: string } | null, formData: FormData) {
  const parsed = CreateTaskFormSchema.safeParse({ title: formData.get('title') });
  if (!parsed.success) {
    return { error: 'Title is required.' };
  }
  try {
    await tasksApi.create({
      title: parsed.data.title,
      priority: 4,
      source: 'manual',
    });
  } catch (err) {
    return { error: err instanceof ApiError ? `API ${err.status}` : (err as Error).message };
  }
  revalidatePath('/');
  return {};
}

export async function toggleTaskDoneAction(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '');
  const currentStatus = String(formData.get('status') ?? 'open');
  if (!taskId) return;
  try {
    await tasksApi.update(taskId, {
      status: currentStatus === 'done' ? 'open' : 'done',
    });
  } catch {
    // Best-effort; UI will reload on next request and reflect reality.
  }
  revalidatePath('/');
  revalidatePath('/attention');
  revalidatePath('/work');
}

export async function toggleTop3Action(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '');
  const currentlyTop3 = formData.get('isTop3') === 'true';
  if (!taskId) return;
  try {
    await tasksApi.update(taskId, {
      // Set to today's date to mark; null to unmark.
      top3_for_date: currentlyTop3 ? null : todayIsoDate(await getAppTimezone()),
    } as Parameters<typeof tasksApi.update>[1]);
  } catch {
    // ignore — revalidate will resync
  }
  revalidatePath('/');
}

// Log a check-in with a silent client straight from Today (Phase 5). Creates a
// minimal conversation — the create route's trigger stamps the company's
// last_interaction_at and clears the company_silent attention item, so the
// client drops off the Silent-clients list on the next render. interaction_type
// is 'other' (an unspecified touch); refine it on the company page if needed.
export async function logCheckInAction(formData: FormData) {
  const companyId = String(formData.get('company_id') ?? '');
  if (!companyId) return;
  try {
    await conversationsApi.create({
      company_id: companyId,
      interaction_type: 'other',
      direction: 'outbound',
      summary: 'Checked in',
      occurred_at: new Date().toISOString(),
    });
  } catch {
    /* best-effort — the list reloads on next render */
  }
  revalidatePath('/');
  revalidatePath('/attention');
  revalidatePath('/companies');
}

export async function dismissObservationAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await observationsApi.dismiss(id);
  } catch {
    /* best-effort */
  }
  revalidatePath('/');
  revalidatePath('/observations');
}

// ─── Resurfacing cycle ───────────────────────────────────────────────────
//
// "Next" button on the Resurfaced card. Stamps the current item's id into
// a "resurfacing_seen" cookie keyed by today's date so the picker skips
// it on the next render. New day → cookie auto-resets (we ignore stale
// dates server-side). The cookie is httpOnly so it never gets read by
// page JS — only by the next server render via getResurfacingSeen().

const RESURFACING_COOKIE = 'resurfacing_seen';

interface SeenCookie { date: string; ids: string[] }

function parseSeen(raw: string | undefined, todayIso: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SeenCookie;
    if (parsed?.date !== todayIso) return [];
    if (!Array.isArray(parsed.ids)) return [];
    return parsed.ids.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

export async function getResurfacingSeen(): Promise<string[]> {
  const jar = await cookies();
  const raw = jar.get(RESURFACING_COOKIE)?.value;
  const tz = await getAppTimezone();
  return parseSeen(raw, todayIsoDate(tz));
}

export async function skipResurfacingAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);
  const jar = await cookies();
  const current = parseSeen(jar.get(RESURFACING_COOKIE)?.value, today);
  if (!current.includes(id)) current.push(id);
  const value: SeenCookie = { date: today, ids: current };
  jar.set(RESURFACING_COOKIE, JSON.stringify(value), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // 36-hour TTL so a cookie persisted across midnight gets cleared
    // by the server-side date check anyway. The TTL is just belt +
    // suspenders against a stale cookie surviving forever.
    maxAge: 60 * 60 * 36,
  });
  revalidatePath('/');
}

export async function resetResurfacingAction() {
  const jar = await cookies();
  jar.delete(RESURFACING_COOKIE);
  revalidatePath('/');
}
