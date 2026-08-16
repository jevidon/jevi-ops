'use server';

import { revalidatePath } from 'next/cache';
import {
  conversationsApi,
  ApiError,
  type ConversationCreate,
  type ConversationInteractionType,
  type ConversationDirection,
} from '@/lib/api';

export type ConvResult = { ok: true } | { ok: false; error: string };

const TYPES: readonly ConversationInteractionType[] = [
  'email', 'call', 'text_message', 'social_dm', 'in_person', 'meeting', 'video_call', 'other',
];
const DIRECTIONS: readonly ConversationDirection[] = ['inbound', 'outbound', 'internal'];

// Revalidate the page the form was submitted from (passed as a hidden field)
// plus the CRM index pages, so a new/removed conversation shows up wherever
// it's referenced. Today + Attention too, since logging a conversation can
// clear a "silent client" attention item server-side.
function revalidateScopes(fromPath: string | null) {
  if (fromPath) revalidatePath(fromPath);
  revalidatePath('/companies');
  revalidatePath('/people');
  revalidatePath('/today');
  revalidatePath('/attention');
}

export async function createConversationAction(
  _prev: ConvResult | null,
  formData: FormData,
): Promise<ConvResult> {
  const summary = String(formData.get('summary') ?? '').trim();
  if (!summary) return { ok: false, error: 'Summary is required.' };

  const rawType = String(formData.get('interaction_type') ?? '');
  const interaction_type = (TYPES as readonly string[]).includes(rawType)
    ? (rawType as ConversationInteractionType)
    : 'other';
  const rawDir = String(formData.get('direction') ?? '');
  const direction = (DIRECTIONS as readonly string[]).includes(rawDir)
    ? (rawDir as ConversationDirection)
    : 'internal';

  const company_id = String(formData.get('company_id') ?? '').trim() || null;
  const person_id = String(formData.get('person_id') ?? '').trim() || null;
  const project_id = String(formData.get('project_id') ?? '').trim() || null;
  if (!company_id && !person_id && !project_id) {
    return { ok: false, error: 'A conversation needs a company, person, or project.' };
  }

  const subject = String(formData.get('subject') ?? '').trim() || null;
  // A bare date input ('YYYY-MM-DD') stored as timestamptz would be read as
  // midnight UTC and render as the *previous* day in western US timezones.
  // Anchor at noon UTC so the displayed day matches what the user picked.
  // (Omitted → the DB defaults occurred_at to now(), a real timestamp.)
  const rawOccurred = String(formData.get('occurred_at') ?? '').trim();
  const occurred_at = !rawOccurred
    ? null
    : /^\d{4}-\d{2}-\d{2}$/.test(rawOccurred)
      ? `${rawOccurred}T12:00:00Z`
      : rawOccurred;
  const followup_by = String(formData.get('followup_by') ?? '').trim() || null;
  const requires_followup =
    formData.getAll('requires_followup').map(String).includes('on') || Boolean(followup_by);

  const payload: ConversationCreate = {
    company_id, person_id, project_id,
    interaction_type, direction, summary, subject,
    requires_followup, followup_by,
    occurred_at,
  };

  try {
    await conversationsApi.create(payload);
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
  revalidateScopes(String(formData.get('revalidate_path') ?? '') || null);
  return { ok: true };
}

// Mark a follow-up done (Wave 2 #4a). Keeps followup_by for the record —
// the timeline badge and the attention rule key off requires_followup, and
// the API live-clears the conversation_followup attention item.
export async function completeFollowupAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await conversationsApi.update(id, { requires_followup: false });
  } catch {
    /* best-effort */
  }
  revalidateScopes(String(formData.get('revalidate_path') ?? '') || null);
}

export async function deleteConversationAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await conversationsApi.remove(id);
  } catch {
    /* best-effort */
  }
  revalidateScopes(String(formData.get('revalidate_path') ?? '') || null);
}
