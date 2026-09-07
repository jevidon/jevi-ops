'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, assetsApi, maintenanceApi, type AssetKind } from '@/lib/api';

// Server actions for the maintenance module. Same conventions as routines:
// forms post FormData, empty strings become null, numbers parse defensively,
// and every mutation revalidates the surfaces that show maintenance state.

const ASSET_KINDS: readonly AssetKind[] = [
  'vehicle', 'appliance', 'home', 'device', 'equipment', 'other',
];

export type SaveResult = { ok: true } | { ok: false; error: string };

function shapeError(err: unknown): SaveResult {
  if (err instanceof ApiError) {
    const body = err.body as {
      error?: string; message?: string; details?: Record<string, string[]>;
    } | null;
    const detail = body?.details
      ? ` — ${Object.entries(body.details).map(([k, v]) => `${k}: ${v.join('|')}`).join('; ')}`
      : body?.message
        ? ` — ${body.message}`
        : '';
    return { ok: false, error: `API ${err.status} ${body?.error ?? ''}${detail}`.trim() };
  }
  return { ok: false, error: (err as Error).message };
}

function revalidateAll(itemId?: string, assetId?: string) {
  revalidatePath('/'); // attention card + rail tasks
  revalidatePath('/maintenance');
  revalidatePath('/maintenance/assets');
  if (itemId) revalidatePath(`/maintenance/${itemId}`);
  if (assetId) revalidatePath(`/maintenance/assets/${assetId}`);
}

function optionalNumber(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function optionalString(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? '').trim();
  return raw || null;
}

// Cadence fields shared by create + update. The form posts one "date
// interval" number + a days/months unit selector, plus the meter fields.
function readCadenceFields(formData: FormData): {
  interval_days: number | null;
  interval_months: number | null;
  interval_meter: number | null;
  lead_days: number;
  lead_meter: number | null;
} {
  const dateInterval = optionalNumber(formData, 'date_interval');
  const unit = String(formData.get('date_unit') ?? 'months');
  const intDate = dateInterval != null && dateInterval > 0 ? Math.floor(dateInterval) : null;
  const meter = optionalNumber(formData, 'interval_meter');
  const leadDays = optionalNumber(formData, 'lead_days');
  const leadMeter = optionalNumber(formData, 'lead_meter');
  return {
    interval_days: unit === 'days' ? intDate : null,
    interval_months: unit === 'months' ? intDate : null,
    interval_meter: meter != null && meter > 0 ? meter : null,
    lead_days: leadDays != null && leadDays >= 0 ? Math.floor(leadDays) : 14,
    lead_meter: leadMeter != null && leadMeter >= 0 ? leadMeter : null,
  };
}

// ─── Items ───────────────────────────────────────────────────────────────

export async function completeItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const meter = optionalNumber(formData, 'meter');
  const notes = optionalString(formData, 'notes');
  const cost = optionalNumber(formData, 'cost');
  const completedOn = optionalString(formData, 'completed_on');
  try {
    await maintenanceApi.complete(id, {
      ...(completedOn ? { completed_on: completedOn } : {}),
      meter,
      notes,
      cost,
    });
  } catch {
    /* best-effort — UI reloads next render */
  }
  revalidateAll(id);
}

export async function createItemAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  const cadence = readCadenceFields(formData);
  if (cadence.interval_days == null && cadence.interval_months == null && cadence.interval_meter == null) {
    return { ok: false, error: 'Set a date interval, a meter interval, or both.' };
  }
  const asset_id = optionalString(formData, 'asset_id');
  const domain_id = optionalString(formData, 'domain_id');
  let created;
  try {
    created = await maintenanceApi.create({
      name,
      notes: optionalString(formData, 'notes'),
      asset_id,
      ...(domain_id ? { domain_id } : {}),
      ...cadence,
      last_completed_on: optionalString(formData, 'last_completed_on'),
      last_completed_meter: optionalNumber(formData, 'last_completed_meter'),
    });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(undefined, asset_id ?? undefined);
  redirect(`/maintenance/${created.item.id}`);
}

export async function updateItemAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!id) return { ok: false, error: 'Missing id.' };
  if (!name) return { ok: false, error: 'Name is required.' };
  const cadence = readCadenceFields(formData);
  const asset_id = optionalString(formData, 'asset_id');
  const domain_id = optionalString(formData, 'domain_id');
  try {
    await maintenanceApi.update(id, {
      name,
      notes: optionalString(formData, 'notes'),
      asset_id,
      ...(domain_id ? { domain_id } : {}),
      ...cadence,
    });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(id, asset_id ?? undefined);
  return { ok: true };
}

export async function setItemActiveAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const active = formData.get('active') === 'true';
  if (!id) return;
  try {
    await maintenanceApi.update(id, { active });
  } catch {
    /* best-effort */
  }
  revalidateAll(id);
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await maintenanceApi.remove(id);
  } catch {
    /* best-effort */
  }
  revalidateAll();
  redirect('/maintenance');
}

export async function deleteLogAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const logId = String(formData.get('log_id') ?? '');
  if (!id || !logId) return;
  try {
    await maintenanceApi.deleteLog(id, logId);
  } catch {
    /* best-effort */
  }
  revalidateAll(id);
}

// ─── Assets ──────────────────────────────────────────────────────────────

export async function createAssetAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  const rawKind = String(formData.get('kind') ?? 'other');
  const kind = (ASSET_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as AssetKind)
    : 'other';
  let created;
  try {
    created = await assetsApi.create({
      name,
      kind,
      domain_id: optionalString(formData, 'domain_id'),
      meter_unit: optionalString(formData, 'meter_unit'),
      notes: optionalString(formData, 'notes'),
    });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll();
  redirect(`/maintenance/assets/${created.asset.id}`);
}

export async function updateAssetAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!id) return { ok: false, error: 'Missing id.' };
  if (!name) return { ok: false, error: 'Name is required.' };
  const rawKind = String(formData.get('kind') ?? 'other');
  const kind = (ASSET_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as AssetKind)
    : 'other';
  try {
    await assetsApi.update(id, {
      name,
      kind,
      domain_id: optionalString(formData, 'domain_id'),
      meter_unit: optionalString(formData, 'meter_unit'),
      notes: optionalString(formData, 'notes'),
    });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(undefined, id);
  return { ok: true };
}

export async function deleteAssetAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await assetsApi.remove(id);
  } catch {
    /* best-effort */
  }
  revalidateAll();
  redirect('/maintenance/assets');
}

export async function addReadingAction(formData: FormData): Promise<void> {
  const assetId = String(formData.get('asset_id') ?? '');
  const reading = optionalNumber(formData, 'reading');
  if (!assetId || reading == null || reading < 0) return;
  const recordedOn = optionalString(formData, 'recorded_on');
  try {
    await assetsApi.addReading(assetId, {
      reading,
      ...(recordedOn ? { recorded_on: recordedOn } : {}),
      notes: optionalString(formData, 'notes'),
    });
  } catch {
    /* best-effort */
  }
  revalidateAll(undefined, assetId);
}
