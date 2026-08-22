'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { domainsApi, ApiError } from '@/lib/api';

export type CreateResult = { ok: false; error: string };

// Create a domain, then land on its detail page (where cadence rules and
// the illustration get set up). redirect() throws internally, so it lives
// outside the try/catch — same shape as the project create action.
export async function createDomainAction(
  _prev: CreateResult | null,
  formData: FormData,
): Promise<CreateResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  const description = (String(formData.get('description') ?? '').trim()) || null;

  let id: string;
  try {
    const row = await domainsApi.create({ name, description });
    id = row.id;
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath('/work');
  revalidatePath('/domains');
  revalidatePath('/');
  redirect(`/domains/${id}`);
}
