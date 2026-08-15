'use server';

import { revalidatePath } from 'next/cache';
import { domainsApi, tasksApi, ApiError } from '@/lib/api';
import {
  CADENCE_RULE_TYPES,
  PRIMARY_CADENCE_RULES,
  type CadenceRuleType,
} from './cadence-rules';

export type SaveResult = { ok: true } | { ok: false; error: string };

// ─── Quick-add task ──────────────────────────────────────────────────────
//
// Title-only capture straight into this domain (a direct task — no
// project), mirroring /today's quick add but routed here instead of
// Inbox. Everything else (due date, priority, project) is the full
// editor's job: /tasks/new?domain_id=… pre-selects this domain.

export async function quickAddTaskAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return { ok: false, error: 'Title is required.' };

  try {
    await tasksApi.create({
      title,
      domain_id: id,
      priority: 4,
      source: 'manual',
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath(`/domains/${id}`);
  // The Work page's per-domain rollups and /today's open-task counts
  // both read from tasks — keep them honest.
  revalidatePath('/work');
  revalidatePath('/today');
  return { ok: true };
}

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
  const stale_enabled = formData.get('stale_enabled') === 'on';
  // Attention staleness threshold — clamp to a sane positive int; blank/invalid
  // falls back to the rule's default (null → 21).
  const staleDaysRaw = parseInt(String(formData.get('stale_days') ?? ''), 10);
  const stale_days = Number.isFinite(staleDaysRaw) && staleDaysRaw > 0 ? staleDaysRaw : null;

  try {
    await domainsApi.update(id, {
      name,
      description,
      fruit_definition,
      active,
      stale_enabled,
      stale_days,
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

// ─── Domain illustrations ────────────────────────────────────────────────
//
// Drawing a candidate never overwrites the saved art. The API owns the
// whole pipeline (LLM compose → sanitize → persist to the draft slot);
// these actions just trigger draft / keep / discard and revalidate.
// Draft only refreshes the detail page; commit and discard also refresh
// /work (the section headers show committed art).

export type IllustrationActionResult =
  | { ok: true; source?: 'llm' | 'procedural' }
  | { ok: false; error: string };

function illustrationError(err: unknown): IllustrationActionResult {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | null;
    if (body?.error === 'no_draft') return { ok: false, error: 'No candidate to keep — draw one first.' };
    return { ok: false, error: body?.error ?? `API ${err.status}` };
  }
  return { ok: false, error: (err as Error).message };
}

export async function draftIllustrationAction(
  _prev: IllustrationActionResult | null,
  formData: FormData,
): Promise<IllustrationActionResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  try {
    const domain = await domainsApi.draftIllustration(id);
    revalidatePath(`/domains/${id}`);
    return { ok: true, source: domain.illustration_draft?.source };
  } catch (err) {
    return illustrationError(err);
  }
}

export async function commitIllustrationAction(
  _prev: IllustrationActionResult | null,
  formData: FormData,
): Promise<IllustrationActionResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  try {
    await domainsApi.commitIllustration(id);
    revalidatePath(`/domains/${id}`);
    revalidatePath('/work');
    return { ok: true };
  } catch (err) {
    return illustrationError(err);
  }
}

export async function discardIllustrationAction(
  _prev: IllustrationActionResult | null,
  formData: FormData,
): Promise<IllustrationActionResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  try {
    await domainsApi.discardIllustrationDraft(id);
    revalidatePath(`/domains/${id}`);
    revalidatePath('/work');
    return { ok: true };
  } catch (err) {
    return illustrationError(err);
  }
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
