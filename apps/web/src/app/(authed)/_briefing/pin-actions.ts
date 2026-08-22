'use server';

import { revalidatePath } from 'next/cache';
import { pinsApi, ApiError } from '@/lib/api';
import { PinTargetTypeSchema } from '@jevi-ops/shared/schemas';

// Server actions for Briefing pins. Same shape as today/actions.ts: plain
// <form action=…> posts, best-effort error handling, then revalidate. Pin
// and unpin revalidate BOTH the Briefing and the originating detail page
// (hidden `path` field) so the PinButton's state never goes stale.

function target(formData: FormData) {
  const type = PinTargetTypeSchema.safeParse(formData.get('target_type'));
  const id = String(formData.get('target_id') ?? '');
  if (!type.success || !id) return null;
  return { type: type.data, id };
}

function revalidate(formData: FormData) {
  revalidatePath('/');
  const path = String(formData.get('path') ?? '');
  if (path.startsWith('/')) revalidatePath(path);
}

export async function pinAction(formData: FormData): Promise<void> {
  const t = target(formData);
  if (!t) return;
  try {
    await pinsApi.create(t.type, t.id);
  } catch (err) {
    // 404 target_not_found and transient failures alike: the page re-renders
    // with true state either way.
    if (!(err instanceof ApiError)) throw err;
  }
  revalidate(formData);
}

export async function unpinAction(formData: FormData): Promise<void> {
  const t = target(formData);
  if (!t) return;
  try {
    await pinsApi.remove(t.type, t.id);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  revalidate(formData);
}

// Move one pin up/down within the pinned list: swap with its neighbor, then
// PATCH the full ordered id list (the API's contract — no single-move
// ambiguity, and unlisted ids re-append server-side).
export async function movePinAction(formData: FormData): Promise<void> {
  const pinId = String(formData.get('pin_id') ?? '');
  const dir = formData.get('dir') === 'up' ? -1 : 1;
  if (!pinId) return;
  try {
    const { pins } = await pinsApi.list();
    const ids = pins.map((p) => p.id);
    const i = ids.indexOf(pinId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await pinsApi.reorder(ids);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  revalidatePath('/');
}
