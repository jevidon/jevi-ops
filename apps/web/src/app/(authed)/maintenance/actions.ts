'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ApiError,
  assetsApi,
  maintenanceApi,
  type AssetKind,
  type AssetLifecycle,
  type MaintenancePolicy,
} from '@/lib/api';

// Server actions for the maintenance module. Forms post FormData, empty
// strings become null, numbers parse defensively, and every mutation
// revalidates the surfaces that show maintenance state.
//
// Every action returns a SaveResult (0048): a failed completion, reading, or
// undo is SHOWN, with the entered values kept — silently swallowing an error
// meant the user couldn't tell whether maintenance was recorded.

const ASSET_KINDS: readonly AssetKind[] = ['vehicle', 'appliance', 'home', 'device', 'equipment', 'other'];
const LIFECYCLES: readonly AssetLifecycle[] = ['active', 'stored', 'sold', 'archived'];
const POLICIES: readonly MaintenancePolicy[] = ['interval', 'expiry', 'prepaid_meter', 'on_condition'];

export type SaveResult = { ok: true; message?: string } | { ok: false; error: string };

function shapeError(err: unknown): SaveResult {
  if (err instanceof ApiError) {
    const body = err.body as {
      error?: string; message?: string; details?: Record<string, string[]>;
    } | null;
    if (body?.message) return { ok: false, error: body.message };
    const detail = body?.details
      ? Object.entries(body.details).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ')
      : '';
    return { ok: false, error: detail || `${body?.error ?? 'request failed'} (HTTP ${err.status})` };
  }
  return { ok: false, error: (err as Error).message };
}

function revalidateAll(itemId?: string, assetId?: string) {
  revalidatePath('/'); // attention card + rail tasks
  revalidatePath('/tasks');
  revalidatePath('/work'); // asset cards carry maintenance counts (0049)
  revalidatePath('/domains/[id]', 'page');
  revalidatePath('/maintenance');
  revalidatePath('/maintenance/assets');
  if (itemId) revalidatePath(`/maintenance/${itemId}`);
  if (assetId) revalidatePath(`/assets/${assetId}`);
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

function oneOf<T extends string>(raw: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

// Cadence fields shared by create + update. The form posts one "date
// interval" number + a days/months unit selector, plus the meter fields.
// Only the fields the form actually carries are sent — the API re-derives
// an axis only when its interval VALUE changes, so echoing is safe, but
// omitting what the form doesn't own keeps intent obvious.
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

export async function completeItemAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing item.' };
  const completedOn = optionalString(formData, 'completed_on');
  // Per-render idempotency key: a double submit of the same form is one
  // completion; two distinct services on one day are two.
  const eventKey = optionalString(formData, 'event_key');
  try {
    const res = await maintenanceApi.complete(id, {
      ...(completedOn ? { completed_on: completedOn } : {}),
      ...(eventKey ? { event_key: eventKey } : {}),
      meter: optionalNumber(formData, 'meter'),
      allow_decrease: formData.get('allow_decrease') === 'on',
      notes: optionalString(formData, 'notes'),
      cost: optionalNumber(formData, 'cost'),
      issued_until: optionalString(formData, 'issued_until'),
      purchased_to: optionalNumber(formData, 'purchased_to'),
      finding: optionalString(formData, 'finding'),
      next_review_on: optionalString(formData, 'next_review_on'),
      next_review_meter: optionalNumber(formData, 'next_review_meter'),
    });
    revalidateAll(id, res.item.asset_id ?? undefined);
    if (res.historical) return { ok: true, message: 'Recorded as history — the current schedule is unchanged.' };
    if (!res.logged) return { ok: true, message: 'Already recorded.' };
    return { ok: true, message: 'Completed.' };
  } catch (err) {
    return shapeError(err);
  }
}

export async function createItemAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  const policy = oneOf(String(formData.get('policy') ?? 'interval'), POLICIES, 'interval');
  const cadence = readCadenceFields(formData);
  if (policy === 'interval' && cadence.interval_days == null && cadence.interval_months == null && cadence.interval_meter == null) {
    return { ok: false, error: 'Set a date interval, a meter interval, or both.' };
  }
  const asset_id = optionalString(formData, 'asset_id');
  const domain_id = optionalString(formData, 'domain_id');
  // Seed evidence and pins are sent ONLY when filled in. To the API an
  // explicit null is an intentional "clear this axis" — posting one for a
  // blank input would erase the date it just derived from the baseline.
  const seed: Record<string, string | number> = {};
  const lastOn = optionalString(formData, 'last_completed_on');
  const lastMeter = optionalNumber(formData, 'last_completed_meter');
  const pinDate = optionalString(formData, 'next_due_date');
  const pinMeter = optionalNumber(formData, 'next_due_meter');
  if (lastOn) seed.last_completed_on = lastOn;
  if (lastMeter != null) seed.last_completed_meter = lastMeter;
  if (pinDate) seed.next_due_date = pinDate;
  if (pinMeter != null) seed.next_due_meter = pinMeter;
  let created;
  try {
    created = await maintenanceApi.create({
      name,
      notes: optionalString(formData, 'notes'),
      asset_id,
      domain_id,
      policy,
      system: optionalString(formData, 'system'),
      ...cadence,
      ...seed,
    });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(undefined, asset_id ?? undefined);
  redirect(`/maintenance/${created.item.id}`);
}

// Seed evidence for an existing item — "last done on … at …" — creating or
// editing its baseline log. Never a completion, never a reading.
export async function setBaselineAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  const completedOn = optionalString(formData, 'completed_on');
  if (!id) return { ok: false, error: 'Missing item.' };
  if (!completedOn) return { ok: false, error: 'Enter the date it was last done.' };
  let res;
  try {
    res = await maintenanceApi.setBaseline(id, { completed_on: completedOn, meter: optionalNumber(formData, 'meter') });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(id, res.item.asset_id ?? undefined);
  return { ok: true, message: 'Baseline saved — the schedule anchors here.' };
}

export async function updateItemAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!id) return { ok: false, error: 'Missing id.' };
  if (!name) return { ok: false, error: 'Name is required.' };
  const policy = oneOf(String(formData.get('policy') ?? 'interval'), POLICIES, 'interval');
  const cadence = readCadenceFields(formData);
  const asset_id = optionalString(formData, 'asset_id');
  const domain_id = optionalString(formData, 'domain_id');
  try {
    await maintenanceApi.update(id, {
      name,
      notes: optionalString(formData, 'notes'),
      asset_id,
      domain_id,
      policy,
      system: optionalString(formData, 'system'),
      ...cadence,
    });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(id, asset_id ?? undefined);
  return { ok: true, message: 'Saved.' };
}

export async function setItemActiveAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  const active = formData.get('active') === 'true';
  if (!id) return { ok: false, error: 'Missing id.' };
  try {
    await maintenanceApi.update(id, { active });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(id);
  return { ok: true, message: active ? 'Reactivated.' : 'Paused — its open task was retired.' };
}

export async function deleteItemAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  try {
    await maintenanceApi.remove(id);
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll();
  redirect('/maintenance');
}

export async function deleteLogAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  const logId = String(formData.get('log_id') ?? '');
  if (!id || !logId) return { ok: false, error: 'Missing log.' };
  try {
    await maintenanceApi.deleteLog(id, logId);
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(id);
  return { ok: true, message: 'Undone — schedule re-derived from the remaining history.' };
}

// ─── Assets ──────────────────────────────────────────────────────────────

export async function createAssetAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  const kind = oneOf(String(formData.get('kind') ?? 'other'), ASSET_KINDS, 'other');
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
  if (created.asset.domain_id) revalidatePath(`/domains/${created.asset.domain_id}`);
  redirect(`/assets/${created.asset.id}`);
}

export async function updateAssetAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!id) return { ok: false, error: 'Missing id.' };
  if (!name) return { ok: false, error: 'Name is required.' };
  const kind = oneOf(String(formData.get('kind') ?? 'other'), ASSET_KINDS, 'other');
  const lifecycle = oneOf(String(formData.get('lifecycle') ?? 'active'), LIFECYCLES, 'active');
  try {
    await assetsApi.update(id, {
      name,
      kind,
      lifecycle,
      domain_id: optionalString(formData, 'domain_id'),
      meter_unit: optionalString(formData, 'meter_unit'),
      notes: optionalString(formData, 'notes'),
    });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(undefined, id);
  return { ok: true, message: 'Saved.' };
}

export async function deleteAssetAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  try {
    await assetsApi.remove(id);
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll();
  redirect('/maintenance/assets');
}

export async function addReadingAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const assetId = String(formData.get('asset_id') ?? '');
  const reading = optionalNumber(formData, 'reading');
  if (!assetId) return { ok: false, error: 'Missing asset.' };
  if (reading == null || reading < 0) return { ok: false, error: 'Enter a reading.' };
  const recordedOn = optionalString(formData, 'recorded_on');
  const eventKey = optionalString(formData, 'event_key');
  let res;
  try {
    res = await assetsApi.addReading(assetId, {
      reading,
      ...(recordedOn ? { recorded_on: recordedOn } : {}),
      ...(eventKey ? { event_key: eventKey } : {}),
      notes: optionalString(formData, 'notes'),
      allow_decrease: formData.get('allow_decrease') === 'on',
    });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(undefined, assetId);
  // logged:false = the API matched an earlier event with this key — a
  // retry or double-tap. Say so rather than claiming a second reading.
  return { ok: true, message: res.logged ? 'Reading logged.' : 'Already logged — that submission was recorded earlier.' };
}

export async function voidReadingAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const assetId = String(formData.get('asset_id') ?? '');
  const rid = String(formData.get('reading_id') ?? '');
  if (!assetId || !rid) return { ok: false, error: 'Missing reading.' };
  try {
    await assetsApi.voidReading(assetId, rid);
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(undefined, assetId);
  return { ok: true, message: 'Reading voided.' };
}
