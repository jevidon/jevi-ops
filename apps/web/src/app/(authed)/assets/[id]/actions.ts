'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, assetsApi } from '@/lib/api';

// Server actions for the asset page (0049). Two things the page owns that
// the maintenance module doesn't: the asset's domain assignment (what
// promotes it into a domain) and its facts (the metadata jsonb, edited as
// key/value rows).

export type SaveResult = { ok: true; message?: string } | { ok: false; error: string };

function shapeError(err: unknown): SaveResult {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return { ok: false, error: body?.message ?? body?.error ?? `HTTP ${err.status}` };
  }
  return { ok: false, error: (err as Error).message };
}

function revalidateAsset(assetId: string, domainIds: Array<string | null | undefined>) {
  revalidatePath(`/assets/${assetId}`);
  revalidatePath('/work');
  revalidatePath('/maintenance/assets');
  for (const d of domainIds) if (d) revalidatePath(`/domains/${d}`);
}

// Assign / reassign / unassign. Unassigning drops the asset back to
// maintenance-only visibility; its schedules and history are untouched.
export async function assignAssetDomainAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const assetId = String(formData.get('asset_id') ?? '').trim();
  const domainId = String(formData.get('domain_id') ?? '').trim() || null;
  const previous = String(formData.get('previous_domain_id') ?? '').trim() || null;
  if (!assetId) return { ok: false, error: 'Missing asset.' };
  try {
    await assetsApi.update(assetId, { domain_id: domainId });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAsset(assetId, [domainId, previous]);
  return { ok: true, message: domainId ? 'Assigned — it now shows in that domain.' : 'Unassigned — maintenance only.' };
}

// Facts: rows of key/value posted as JSON. A value the agent wrote in the
// rich form ({ value, source, observed_on, verified }) is preserved when the
// human didn't change it; an edited value replaces it with a bare scalar
// (the provenance no longer holds). Numbers and booleans are coerced from
// their obvious spellings so "2019" stays a number.
export async function saveAssetFactsAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const assetId = String(formData.get('asset_id') ?? '').trim();
  if (!assetId) return { ok: false, error: 'Missing asset.' };
  let rows: Array<{ key: string; value: string }>;
  try {
    rows = JSON.parse(String(formData.get('facts') ?? '[]'));
    if (!Array.isArray(rows)) throw new Error('bad payload');
  } catch {
    return { ok: false, error: 'Could not read the facts.' };
  }

  let original: Record<string, unknown> = {};
  try {
    original = (await assetsApi.get(assetId)).asset.metadata ?? {};
  } catch (err) {
    return shapeError(err);
  }

  const metadata: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const key = String(row.key ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) continue;
    if (seen.has(key)) return { ok: false, error: `Duplicate fact: ${key}.` };
    seen.add(key);
    const value = String(row.value ?? '').trim();
    if (!value) continue;
    const prev = original[key];
    if (prev && typeof prev === 'object' && 'value' in (prev as Record<string, unknown>)) {
      const rich = prev as { value: unknown };
      if (String(rich.value) === value) {
        metadata[key] = prev;
        continue;
      }
    }
    metadata[key] = coerce(value);
  }

  try {
    await assetsApi.update(assetId, { metadata });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAsset(assetId, []);
  return { ok: true, message: 'Facts saved.' };
}

function coerce(v: string): string | number | boolean {
  if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 16) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}
