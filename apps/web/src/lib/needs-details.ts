import { ApiError } from '@/lib/api';

// A maintenance-generated task whose item needs evidence (an expiry's new
// date, a licence's end distance, an inspection's finding) can't be ticked
// off blind: the API refuses with 409 needs_details and leaves the task
// open. Task actions route the person to the item's completion form
// instead of failing quietly. Plain module (not 'use server') so the
// server actions can share it.
export function maintenanceDetailsHref(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as { error?: string; item_id?: string } | null;
  return body?.error === 'needs_details' && body.item_id ? `/maintenance/${body.item_id}#complete` : null;
}
