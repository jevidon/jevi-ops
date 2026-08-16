'use server';

import { revalidatePath } from 'next/cache';
import { shoppingApi, ApiError, type ShoppingRecurrenceRule } from '@/lib/api';
import { isRecurrencePattern } from '@jevi-ops/shared';

// Server actions for the Shopping module. Same shapes as the project
// checklist actions: SaveResult for useActionState forms (input clears on
// success), Promise<void> for fire-and-forget toggles. purchaseItemAction
// additionally returns the ledger row id so the row can offer a
// transient "Bought · Undo".

export type SaveResult = { ok: true } | { ok: false; error: string };
export type PurchaseResult =
  | { ok: true; purchaseId: string }
  | { ok: false; error: string };

function errMessage(err: unknown): string {
  if (err instanceof ApiError) return `API ${err.status}`;
  return (err as Error).message;
}

// ─── Items ─────────────────────────────────────────────────────────────

export async function addItemAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const listId = String(formData.get('listId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!listId) return { ok: false, error: 'Missing list id.' };
  if (!name) return { ok: false, error: 'Name required.' };
  try {
    // New items arrive flagged: you add something because you need it.
    await shoppingApi.items.create({ list_id: listId, name, needed: true });
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
  revalidatePath('/shopping');
  return { ok: true };
}

export async function flagItemAction(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '');
  const needed = formData.get('needed') === 'true';
  if (!itemId) return;
  try {
    await shoppingApi.items.flag(itemId, needed);
  } catch {
    /* best-effort */
  }
  revalidatePath('/shopping');
}

export async function purchaseItemAction(
  _prev: PurchaseResult | null,
  formData: FormData,
): Promise<PurchaseResult> {
  const itemId = String(formData.get('itemId') ?? '');
  if (!itemId) return { ok: false, error: 'Missing item id.' };
  try {
    const res = await shoppingApi.items.purchase(itemId);
    revalidatePath('/shopping');
    return { ok: true, purchaseId: res.purchase.id };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function undoPurchaseAction(formData: FormData): Promise<void> {
  const purchaseId = String(formData.get('purchaseId') ?? '');
  if (!purchaseId) return;
  try {
    await shoppingApi.undoPurchase(purchaseId);
  } catch {
    /* best-effort */
  }
  revalidatePath('/shopping');
}

export async function updateItemAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const itemId = String(formData.get('itemId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  const listId = String(formData.get('listId') ?? '');
  const rawRule = String(formData.get('recurrence_rule') ?? '').trim();
  if (!itemId) return { ok: false, error: 'Missing item id.' };
  if (!name) return { ok: false, error: 'Name required.' };
  const recurrence_rule: ShoppingRecurrenceRule | null = isRecurrencePattern(rawRule)
    ? rawRule
    : null;
  try {
    await shoppingApi.items.update(itemId, {
      name,
      note: note || null,
      recurrence_rule,
      ...(listId ? { list_id: listId } : {}),
    });
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
  revalidatePath('/shopping');
  return { ok: true };
}

export async function archiveItemAction(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '');
  if (!itemId) return;
  try {
    await shoppingApi.items.update(itemId, { archived_at: new Date().toISOString() });
  } catch {
    /* best-effort */
  }
  revalidatePath('/shopping');
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '');
  if (!itemId) return;
  try {
    await shoppingApi.items.remove(itemId);
  } catch {
    /* best-effort */
  }
  revalidatePath('/shopping');
}

// ─── Lists ─────────────────────────────────────────────────────────────

export async function createListAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Name required.' };
  try {
    await shoppingApi.lists.create({ name });
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
  revalidatePath('/shopping');
  return { ok: true };
}

export async function renameListAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const listId = String(formData.get('listId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!listId) return { ok: false, error: 'Missing list id.' };
  if (!name) return { ok: false, error: 'Name required.' };
  try {
    await shoppingApi.lists.update(listId, { name });
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
  revalidatePath('/shopping');
  return { ok: true };
}

export async function archiveListAction(formData: FormData): Promise<void> {
  const listId = String(formData.get('listId') ?? '');
  if (!listId) return;
  try {
    await shoppingApi.lists.update(listId, { archived_at: new Date().toISOString() });
  } catch {
    /* best-effort */
  }
  revalidatePath('/shopping');
}

export async function deleteListAction(formData: FormData): Promise<void> {
  const listId = String(formData.get('listId') ?? '');
  if (!listId) return;
  try {
    await shoppingApi.lists.remove(listId);
  } catch {
    /* best-effort */
  }
  revalidatePath('/shopping');
}

// ─── Import ────────────────────────────────────────────────────────────

export type ImportResult =
  | { ok: true; lists: number; items: number; skipped: number }
  | { ok: false; error: string };

export async function importShoppingAction(
  _prev: ImportResult | null,
  formData: FormData,
): Promise<ImportResult> {
  const text = String(formData.get('text') ?? '').trim();
  if (!text) return { ok: false, error: 'Paste your markdown first.' };
  try {
    const res = await shoppingApi.import(text);
    revalidatePath('/shopping');
    return {
      ok: true,
      lists: res.lists_created,
      items: res.items_created,
      skipped: res.items_skipped,
    };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}
