'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, assetsApi, type MetadataPatch } from '@/lib/api';
import { renderFact } from './facts';

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

// Assign / reassign / unassign. Unassigning drops the asset back to the
// Maintenance list only; its schedules, history, Inbox tasks and attention
// are untouched — awareness never depended on assignment.
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
  revalidatePath('/tasks');
  revalidatePath('/projects');
  return {
    ok: true,
    message: domainId
      ? 'Assigned — it now shows in that domain, and its projects and open upkeep moved with it.'
      : 'Unassigned — listed under Maintenance only; its upkeep still lands in Inbox.',
  };
}

// Facts, saved as a PATCH the API applies with per-key compare-and-set.
// The form posts the rows as edited AND the originals it rendered from
// (`original`: key → raw stored value, editable keys only). We diff:
//   * untouched rows are not sent at all — whatever is stored (a bare
//     scalar, a rich {value, source…} fact, a leading-zero serial) stays
//     exactly as it was;
//   * a changed row is `set` with `expected` = the original, so an agent
//     that changed the same key meanwhile turns this into a 409, not an
//     overwrite; a new row expects nothing there (null);
//   * a removed row is `unset` with `expected`.
// Structured values (objects with no scalar `value`) never appear in the
// form and are therefore never touched. Typing is per field, not by
// appearance: only the keys below become numbers — a serial "001234" or a
// plate stays the string it is.
const NUMERIC_KEYS = new Set(['year', 'purchased_meter']);

function typed(key: string, value: string): string | number {
  if (NUMERIC_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export async function saveAssetFactsAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const assetId = String(formData.get('asset_id') ?? '').trim();
  if (!assetId) return { ok: false, error: 'Missing asset.' };
  let rows: Array<{ key: string; value: string }>;
  let original: Record<string, unknown>;
  try {
    rows = JSON.parse(String(formData.get('facts') ?? '[]'));
    original = JSON.parse(String(formData.get('original') ?? '{}'));
    if (!Array.isArray(rows) || !original || typeof original !== 'object') throw new Error('bad payload');
  } catch {
    return { ok: false, error: 'Could not read the facts.' };
  }

  const patch: MetadataPatch = { set: {}, unset: {} };
  const seen = new Set<string>();
  for (const row of rows) {
    const key = String(row.key ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) continue;
    if (seen.has(key)) return { ok: false, error: `Duplicate fact: ${key}.` };
    seen.add(key);
    const value = String(row.value ?? '').trim();
    if (!value) continue; // an emptied row is a removal, handled below
    const had = Object.prototype.hasOwnProperty.call(original, key);
    if (had && renderFact(original[key]) === value) continue; // untouched — never sent
    patch.set![key] = { value: typed(key, value), expected: had ? original[key] : null };
  }
  for (const key of Object.keys(original)) {
    if (!seen.has(key) || !rows.some((r) => String(r.key ?? '').trim().toLowerCase().replace(/\s+/g, '_') === key && String(r.value ?? '').trim())) {
      patch.unset![key] = { expected: original[key] };
    }
  }
  if (Object.keys(patch.set!).length === 0 && Object.keys(patch.unset!).length === 0) {
    return { ok: true, message: 'No changes.' };
  }

  try {
    await assetsApi.update(assetId, { metadata_patch: patch });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const body = err.body as { keys?: string[] } | null;
      const keys = body?.keys?.length ? ` (${body.keys.join(', ')})` : '';
      return { ok: false, error: `Facts changed since you opened them${keys} — reload to see the latest, then re-apply your change.` };
    }
    return shapeError(err);
  }
  revalidateAsset(assetId, []);
  return { ok: true, message: 'Facts saved.' };
}
