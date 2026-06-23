'use server';

import { revalidatePath } from 'next/cache';
import { domainsApi, ApiError } from '@/lib/api';
import {
  CADENCE_RULE_TYPES,
  PRIMARY_CADENCE_RULES,
  type CadenceRuleType,
} from './cadence-rules';

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
  // store blank strings. expected_cadence dropped from the form (made
  // redundant by the cadence rule editor); the column stays in the DB.
  const description = (String(formData.get('description') ?? '').trim()) || null;
  const fruit_definition = (String(formData.get('fruit_definition') ?? '').trim()) || null;
  const active = formData.get('active') === 'on';

  try {
    await domainsApi.update(id, {
      name,
      description,
      fruit_definition,
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

// ─── Cadence rule editor ─────────────────────────────────────────────────
//
// Domains need a `days_since_*` / `no_activity_days` rule in their
// failure_patterns array for the briefing's "In brief" lines and the
// /domains pulse board to evaluate them. Without one, they show as
// "unconfigured." The editor here owns that one rule and merges it back
// with any pre-existing advanced rules so SQL-only rule types
// (deadline_within_days, hours_exceed_quote, etc.) survive a save.
//
// The shared constants live in ./cadence-rules to keep this file as a
// pure 'use server' module (every export here must be an async function).

export type CadenceSaveResult = { ok: true } | { ok: false; error: string };

export async function setCadenceRuleAction(
  _prev: CadenceSaveResult | null,
  formData: FormData,
): Promise<CadenceSaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };

  const ruleRaw = String(formData.get('rule') ?? 'none');
  if (!(CADENCE_RULE_TYPES as readonly string[]).includes(ruleRaw)) {
    return { ok: false, error: 'Invalid rule type.' };
  }
  const rule = ruleRaw as CadenceRuleType;

  let value: number | null = null;
  if (rule !== 'none') {
    const raw = String(formData.get('value') ?? '').trim();
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, error: 'Threshold must be a positive integer (days).' };
    }
    value = parsed;
  }

  // Fetch the current failure_patterns so we can preserve advanced rules
  // (deadline_within_days, hours_exceed_quote, etc.) the editor doesn't
  // manage. Only the primary cadence rule gets replaced.
  let current: Array<{ rule: string; value?: unknown; [k: string]: unknown }> = [];
  try {
    const domain = await domainsApi.get(id);
    current = Array.isArray(domain.failure_patterns)
      ? (domain.failure_patterns as Array<{ rule: string; value?: unknown }>)
      : [];
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }

  const preserved = current.filter((p) => !PRIMARY_CADENCE_RULES.has(p.rule));
  const next = rule === 'none'
    ? preserved
    : [...preserved, { rule, value }];

  try {
    await domainsApi.update(id, { failure_patterns: next });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath(`/domains/${id}`);
  revalidatePath('/domains');
  revalidatePath('/today');
  return { ok: true };
}

// ─── Mark shipped ────────────────────────────────────────────────────────
//
// One-tap "I shipped something for this domain" — stamps the
// last_shipped_at timestamp to now. The cadence helper reads MAX of this
// and the latest content_items.published_at for days_since_publish, so
// users whose work lives off-dashboard (Substack essays, social video,
// etc.) can still keep a real cadence without logging every external
// post as a content_items row.

export type MarkShippedResult = { ok: true; at: string } | { ok: false; error: string };

export async function markShippedAction(
  _prev: MarkShippedResult | null,
  formData: FormData,
): Promise<MarkShippedResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };

  const at = new Date().toISOString();
  try {
    await domainsApi.update(id, { last_shipped_at: at });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath(`/domains/${id}`);
  revalidatePath('/domains');
  revalidatePath('/today');
  return { ok: true, at };
}
