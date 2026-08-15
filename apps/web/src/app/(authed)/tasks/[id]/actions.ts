'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { tasksApi, ApiError } from '@/lib/api';
import { isRecurrencePattern } from '@jevi-ops/shared';

export type SaveResult = { ok: true } | { ok: false; error: string };

// Form schema — captures every field the shared TaskForm posts. The
// `selection` field encodes either "domain:<uuid>" or "project:<uuid>";
// we decode it server-side before hitting the API. Empty selection on
// create means "let the server default to Inbox."
const TaskFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  notes: z.string().trim(),
  due_date: z.string(),
  due_time: z.string(),
  priority: z.coerce.number().int().min(1).max(4),
  selection: z.string(),
  // Optional — the form only renders the picker when the selected project
  // has milestones, so the field may be absent entirely.
  milestone_id: z.string(),
  content_item_id: z.string(),
  // Single-offset reminder picker on the form. Multi-offset reminders
  // are still supported via the voice parser (which can produce multiple
  // entries in reminder_offsets); we just don't expose that complexity
  // in the manual UI yet.
  remind_minutes: z.string(),
  recurrence_rule: z.string(),
});

function readFormFields(formData: FormData) {
  return TaskFormSchema.safeParse({
    title: formData.get('title'),
    notes: formData.get('notes') ?? '',
    due_date: formData.get('due_date') ?? '',
    due_time: formData.get('due_time') ?? '',
    priority: formData.get('priority') ?? '4',
    selection: formData.get('selection') ?? '',
    milestone_id: formData.get('milestone_id') ?? '',
    content_item_id: formData.get('content_item_id') ?? '',
    remind_minutes: formData.get('remind_minutes') ?? '',
    recurrence_rule: formData.get('recurrence_rule') ?? '',
  });
}

// Decode "domain:<uuid>" / "project:<uuid>" / "" into the API shape. Both
// IDs are sent as null when not present so a switch from project → domain
// (or vice versa) clears the prior link.
function decodeSelection(raw: string): { domain_id: string | null; project_id: string | null } {
  if (raw.startsWith('domain:')) {
    return { domain_id: raw.slice('domain:'.length) || null, project_id: null };
  }
  if (raw.startsWith('project:')) {
    return { domain_id: null, project_id: raw.slice('project:'.length) || null };
  }
  // Empty or malformed → let the server route via its default (Inbox on
  // create). On update with empty selection we send both as null so the
  // server falls back to its routing logic.
  return { domain_id: null, project_id: null };
}

function toApiPayload(parsed: z.infer<typeof TaskFormSchema>) {
  const remindParsed = parsed.remind_minutes ? parseInt(parsed.remind_minutes, 10) : NaN;
  // 0 = "at due time" — keep it; only an empty form value (NaN here)
  // means "no reminder". The cron filters out negatives separately.
  const reminder_offsets = Number.isFinite(remindParsed) && remindParsed >= 0
    ? [remindParsed]
    : [];
  // Only forward known patterns to the DB; everything else (including
  // the empty-string default that means "no repeat") becomes null.
  const recurrence_rule = isRecurrencePattern(parsed.recurrence_rule)
    ? parsed.recurrence_rule
    : null;
  const { domain_id, project_id } = decodeSelection(parsed.selection);
  return {
    title: parsed.title,
    notes: parsed.notes || null,
    due_date: parsed.due_date || null,
    due_time: parsed.due_time || null,
    priority: parsed.priority,
    domain_id,
    project_id,
    // Server-validated: a milestone that doesn't belong to the task's
    // project is parked back to null ("General") by the API.
    milestone_id: parsed.milestone_id || null,
    content_item_id: parsed.content_item_id || null,
    reminder_offsets,
    recurrence_rule,
  };
}

export async function updateTaskAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return { ok: false, error: 'Missing task id.' };
  const parsed = readFormFields(formData);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return { ok: false, error: first?.message ?? 'Invalid form' };
  }
  try {
    await tasksApi.update(taskId, toApiPayload(parsed.data));
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/today');
  revalidatePath('/tasks');
  revalidatePath('/projects');
  revalidatePath('/content');
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

// Full create — used by /tasks/new and the content-detail inline add.
// Distinct from the simple inline create on /today so the rich form can
// set project + content_item + due date + priority in one shot.
//
// Note: redirect() must live OUTSIDE the try/catch. Next.js implements
// redirect by throwing a synthetic NEXT_REDIRECT — putting it inside try
// makes the catch block swallow it as a real error and the UI shows
// "NEXT_REDIRECT" instead of navigating.
export async function createTaskFullAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const parsed = readFormFields(formData);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return { ok: false, error: first?.message ?? 'Invalid form' };
  }
  let createdId: string;
  try {
    const created = await tasksApi.create(toApiPayload(parsed.data));
    createdId = created.id;
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/today');
  revalidatePath('/tasks');
  revalidatePath('/projects');
  revalidatePath('/content');
  if (parsed.data.content_item_id) revalidatePath(`/content/${parsed.data.content_item_id}`);
  redirect(`/tasks/${createdId}`);
}

// Quick-add from the Subtasks ledger on a parent task's detail page.
// The child inherits the parent's project (or direct domain) via hidden
// fields so it lands in the same place without another resolver
// round-trip.
const SubtaskFormSchema = z.object({
  parentId: z.string().uuid(),
  title: z.string().trim().min(1),
  projectId: z.string().uuid().optional(),
  domainId: z.string().uuid().optional(),
});

export async function createSubtaskAction(formData: FormData): Promise<void> {
  const parsed = SubtaskFormSchema.safeParse({
    parentId: formData.get('parentId'),
    title: formData.get('title'),
    projectId: formData.get('projectId') || undefined,
    domainId: formData.get('domainId') || undefined,
  });
  if (!parsed.success) return;
  try {
    await tasksApi.create({
      title: parsed.data.title,
      parent_task_id: parsed.data.parentId,
      project_id: parsed.data.projectId ?? null,
      domain_id: parsed.data.domainId ?? null,
      priority: 4,
      source: 'manual',
    });
  } catch {
    /* best-effort; the page re-renders and reflects reality */
  }
  revalidatePath(`/tasks/${parsed.data.parentId}`);
  revalidatePath('/tasks');
  revalidatePath('/today');
  revalidatePath('/projects');
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return;
  try {
    await tasksApi.remove(taskId);
  } catch {
    /* best-effort */
  }
  revalidatePath('/today');
  revalidatePath('/tasks');
  revalidatePath('/projects');
  revalidatePath('/content');
  redirect('/today');
}
