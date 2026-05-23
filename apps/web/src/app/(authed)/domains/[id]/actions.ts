'use server';

import { revalidatePath } from 'next/cache';
import { domainsApi, ApiError } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function updateDomainAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  // Nullable text fields — empty string becomes null in the DB so we don't
  // store blank strings.
  const description = (String(formData.get('description') ?? '').trim()) || null;
  const fruit_definition = (String(formData.get('fruit_definition') ?? '').trim()) || null;
  const expected_cadence = (String(formData.get('expected_cadence') ?? '').trim()) || null;
  const active = formData.get('active') === 'on';

  try {
    await domainsApi.update(id, {
      name,
      description,
      fruit_definition,
      expected_cadence,
      active,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath(`/domains/${id}`);
  revalidatePath('/domains');
  return { ok: true };
}
