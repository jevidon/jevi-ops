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

// ─── Cadence rule editor ─────────────────────────────────────────────────
//
// Domains need a `days_since_*` / `no_activity_days` rule in their
// failure_patterns array for the briefing's "In brief" lines and the
// /domains pulse board to evaluate them. Without one, they show as
// "unconfigured." The editor here owns that one rule and merges it back
// with any pre-existing advanced rules so SQL-only rule types
// (deadline_within_days, hours_exceed_quote, etc.) survive a save.

export const CADENCE_RULE_TYPES = [
  'none',
  'days_since_journal',
  'days_since_publish',
  'no_activity_days',
] as const;
export type CadenceRuleType = (typeof CADENCE_RULE_TYPES)[number];

const PRIMARY_CADENCE_RULES: Set<string> = new Set(
  CADENCE_RULE_TYPES.filter((r) => r !== 'none'),
);

export const CADENCE_RULE_LABELS: Record<CadenceRuleType, string> = {
  none: 'None — unconfigured',
  days_since_journal: 'Days since a journal entry',
  days_since_publish: 'Days since publish (content_items)',
  no_activity_days: 'Days since project activity (activity_log)',
};

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
