import { z } from 'zod';
import { MAINTENANCE_POLICIES } from '../maintenance.js';
import { docFields, docUpdateFields } from './doc.js';
import { AttachmentSchema } from './note.js';

// Maintenance module (migrations 0047 + 0048) — wire shapes for /api/assets
// and /api/maintenance. Cadence semantics live in ../maintenance.ts
// (policies, re-anchor from completion, whichever-first over date + meter).

// Display/grouping only — no code path may branch on kind. All meter
// behavior gates on meter_unit.
export const AssetKindSchema = z.enum([
  'vehicle',
  'appliance',
  'home',
  'device',
  'equipment',
  'other',
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  vehicle: 'Vehicle',
  appliance: 'Appliance',
  home: 'Home',
  device: 'Device',
  equipment: 'Equipment',
  other: 'Other',
};

// Only active assets generate tasks, attention, and reading nags.
export const AssetLifecycleSchema = z.enum(['active', 'stored', 'sold', 'archived']);
export type AssetLifecycle = z.infer<typeof AssetLifecycleSchema>;

export const MaintenancePolicySchema = z.enum(MAINTENANCE_POLICIES);

const nullableString = () => z.string().nullable().optional();
const nullableDate = () => z.string().date().nullable().optional();
const nullableNonNeg = () => z.number().nonnegative().nullable().optional();

// A fact with provenance: the value, where it came from, when it was
// observed, whether it's been verified. Metadata values may be a bare
// scalar OR this shape — the agent writes the rich form, a human typing
// into the Facts editor writes the bare one, and both render.
export const AssetFactSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  source: z.string().nullable().optional(),
  observed_on: z.string().date().nullable().optional(),
  verified: z.boolean().optional(),
});
export type AssetFact = z.infer<typeof AssetFactSchema>;

// Well-known metadata keys (0049). Generic on purpose — any asset kind may
// use any key, and unknown keys are retained — but these are the ones the
// Facts rail labels and the vehicle agent reads without guessing spelling.
// Values are validated only when present.
export const ASSET_PROFILE_KEYS = [
  'make', 'model', 'year', 'variant', 'engine', 'transmission',
  'vin', 'plate', 'first_registered', 'purchased_on', 'purchased_meter',
  'usage', 'colour', 'serial', 'warranty_until', 'supplier', 'location',
] as const;
export type AssetProfileKey = (typeof ASSET_PROFILE_KEYS)[number];

export const ASSET_PROFILE_LABELS: Record<AssetProfileKey, string> = {
  make: 'Make', model: 'Model', year: 'Year', variant: 'Variant', engine: 'Engine',
  transmission: 'Transmission', vin: 'VIN', plate: 'Plate', first_registered: 'First registered',
  purchased_on: 'Purchased', purchased_meter: 'Purchased at', usage: 'Usage', colour: 'Colour',
  serial: 'Serial', warranty_until: 'Warranty until', supplier: 'Supplier', location: 'Location',
};

// Read the scalar out of a metadata value, whichever form it's in.
export function factValue(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    const inner = (v as { value: unknown }).value;
    return typeof inner === 'string' || typeof inner === 'number' || typeof inner === 'boolean' ? inner : null;
  }
  return null;
}

export const AssetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  kind: AssetKindSchema,
  domain_id: z.string().uuid().nullable().optional(),
  // Free text ('km','mi','hours'…). Null = date-only asset.
  meter_unit: nullableString(),
  // Per-asset facts (VIN, rego, insurance, warranty…): bare scalars or
  // AssetFact objects under any key; ASSET_PROFILE_KEYS are the labelled ones.
  metadata: z.record(z.string(), z.unknown()),
  notes: nullableString(),
  lifecycle: AssetLifecycleSchema,
  // Photos (0049): StoredAttachment[]; [0] is the hero.
  attachments: z.array(AttachmentSchema).default([]),
  // Markdown overview + its version (0050).
  ...docFields,
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const CreateAssetSchema = z.object({
  name: z.string().min(1),
  kind: AssetKindSchema.optional(),
  domain_id: z.string().uuid().nullable().optional(),
  meter_unit: z.string().min(1).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  notes: nullableString(),
  // The overview document, seeded at creation (0050); its first edit
  // snapshots this text into history.
  doc_md: z.string().max(200_000).nullable().optional(),
});

// A facts edit as a PATCH with per-key compare-and-set. `set` writes keys,
// `unset` removes them; an entry's `expected` is the value the writer last
// saw for that key (null = "I saw none"). The API applies the patch under a
// row lock and refuses (409 fact_conflict) any key whose current value no
// longer matches its `expected` — so a human editing the make while an agent
// adds the VIN both land, and two writers on the same key never silently
// overwrite each other. Omit `expected` (JSON undefined) for an
// unconditional write. Untouched keys are never sent, so they are never lost.
export const MetadataPatchSchema = z.object({
  set: z.record(z.string().min(1), z.object({ value: z.unknown(), expected: z.unknown().optional() })).optional(),
  unset: z.record(z.string().min(1), z.object({ expected: z.unknown().optional() })).optional(),
});
export type MetadataPatch = z.infer<typeof MetadataPatchSchema>;

// Photo operations against the CURRENT array, applied under the row lock:
// add appends (duplicates by storage_path ignored), remove drops, hero
// moves one to the front. Whole-array `attachments` stays for imports;
// the gallery uses this so an upload finishing late can't resurrect a
// removed photo or undo a hero choice made meanwhile.
export const AttachmentsPatchSchema = z.object({
  add: z.array(AttachmentSchema).optional(),
  remove: z.array(z.string().min(1)).optional(),
  hero: z.string().min(1).optional(),
});
export type AttachmentsPatch = z.infer<typeof AttachmentsPatchSchema>;

export const UpdateAssetSchema = CreateAssetSchema.partial().extend({
  lifecycle: AssetLifecycleSchema.optional(),
  attachments: z.array(AttachmentSchema).optional(),
  attachments_patch: AttachmentsPatchSchema.optional(),
  // Archive/unarchive goes through the same PATCH (routines precedent).
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
  // Preferred over whole-object `metadata` (which stays for imports and is
  // last-writer-wins): see MetadataPatchSchema.
  metadata_patch: MetadataPatchSchema.optional(),
  ...docUpdateFields,
});

export const MeterReadingSchema = z.object({
  id: z.string().uuid(),
  asset_id: z.string().uuid(),
  reading: z.number().nonnegative(),
  recorded_on: z.string().date(),
  source: z.enum(['manual', 'completion', 'agent', 'import']),
  notes: nullableString(),
  event_key: nullableString(),
  actor: nullableString(),
  voided_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});

export const CreateMeterReadingSchema = z.object({
  reading: z.number().nonnegative(),
  // Omit → server defaults to today in app tz. Never in the future.
  recorded_on: z.string().date().optional(),
  notes: nullableString(),
  // Idempotency key — a repeat with the same key is a no-op.
  event_key: z.string().min(1).max(200).optional(),
  // A reading lower than the latest prior one is refused unless the meter
  // was replaced/reset.
  allow_decrease: z.boolean().optional(),
  // Token callers may declare 'import'; sessions are always 'manual'.
  source: z.enum(['agent', 'import']).optional(),
});

export const UpdateMeterReadingSchema = z.object({
  reading: z.number().nonnegative().optional(),
  recorded_on: z.string().date().optional(),
  notes: nullableString(),
  // A correction is held to the same neighbour checks as a new reading.
  allow_decrease: z.boolean().optional(),
});

export const MaintenanceDueStatusSchema = z.enum(['ok', 'due_soon', 'due', 'overdue']);
export const MaintenanceDataStateSchema = z.enum(['complete', 'needs_baseline', 'needs_reading', 'stale_reading']);

// Computed per-item on the wire by shared maintenanceDueState().
export const MaintenanceDueStateSchema = z.object({
  status: MaintenanceDueStatusSchema,
  trigger: z.enum(['date', 'meter']).nullable(),
  days_until: z.number().int().nullable(),
  meter_remaining: z.number().nullable(),
  data: MaintenanceDataStateSchema,
  reading_age_days: z.number().int().nullable(),
});

export const MaintenanceItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  notes: nullableString(),
  asset_id: z.string().uuid().nullable().optional(),
  // Null = inherit the asset's domain (else Inbox); see effective_domain_id.
  domain_id: z.string().uuid().nullable().optional(),
  policy: MaintenancePolicySchema,
  system: nullableString(),
  interval_days: z.number().int().positive().nullable().optional(),
  interval_months: z.number().int().positive().nullable().optional(),
  interval_meter: z.number().positive().nullable().optional(),
  lead_days: z.number().int().nonnegative(),
  lead_meter: nullableNonNeg(),
  next_due_date: nullableDate(),
  next_due_meter: nullableNonNeg(),
  last_completed_on: nullableDate(),
  last_completed_meter: nullableNonNeg(),
  generated_task_id: z.string().uuid().nullable().optional(),
  active: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  // Optional embeds — present on list/detail responses.
  asset: AssetSchema.pick({ id: true, name: true, kind: true, meter_unit: true, domain_id: true, lifecycle: true }).nullable().optional(),
  effective_domain_id: z.string().uuid().optional(),
  latest_reading: z.number().nullable().optional(),
  latest_reading_on: z.string().date().nullable().optional(),
  due_state: MaintenanceDueStateSchema.optional(),
  // Shared scope (maintenanceTracked): active item on an active asset. False
  // rows keep their due_state for display but count nowhere and prompt nothing.
  tracked: z.boolean().optional(),
});

const cadenceFields = {
  interval_days: z.number().int().positive().nullable().optional(),
  interval_months: z.number().int().positive().nullable().optional(),
  interval_meter: z.number().positive().nullable().optional(),
  lead_days: z.number().int().nonnegative().optional(),
  lead_meter: nullableNonNeg(),
};

export const CreateMaintenanceItemSchema = z
  .object({
    name: z.string().min(1),
    notes: nullableString(),
    asset_id: z.string().uuid().nullable().optional(),
    // Omit/null → inherit the asset's domain, else Inbox.
    domain_id: z.string().uuid().nullable().optional(),
    policy: MaintenancePolicySchema.optional(),
    system: nullableString(),
    ...cadenceFields,
    // Seed history ("last replaced 2026-06-01 at 95,000 km") — stored as an
    // explicit baseline log so next-due computes from evidence…
    last_completed_on: nullableDate(),
    last_completed_meter: nullableNonNeg(),
    // …or pin next-due directly ("brakes due at 150,000 km") without
    // inventing a completion.
    next_due_date: nullableDate(),
    next_due_meter: nullableNonNeg(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) =>
      (v.policy ?? 'interval') !== 'interval' ||
      v.interval_days != null || v.interval_months != null || v.interval_meter != null,
    { message: 'Interval items need interval_days, interval_months, or interval_meter.' },
  )
  .refine((v) => v.interval_days == null || v.interval_months == null, {
    message: 'Use interval_days or interval_months, not both.',
  });

// The XOR / has-interval checks run server-side against the merged row — a
// partial patch can't see the columns it leaves untouched.
export const UpdateMaintenanceItemSchema = z.object({
  name: z.string().min(1).optional(),
  notes: nullableString(),
  asset_id: z.string().uuid().nullable().optional(),
  domain_id: z.string().uuid().nullable().optional(),
  policy: MaintenancePolicySchema.optional(),
  system: nullableString(),
  ...cadenceFields,
  next_due_date: nullableDate(),
  next_due_meter: nullableNonNeg(),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CompleteMaintenanceSchema = z.object({
  // Omit → today in app tz. Older than the current last completion →
  // recorded as history without moving the schedule.
  completed_on: z.string().date().optional(),
  meter: z.number().nonnegative().nullable().optional(),
  notes: nullableString(),
  cost: z.number().nonnegative().nullable().optional(),
  // Idempotency key — a repeat with the same key converges, never doubles.
  event_key: z.string().min(1).max(200).optional(),
  // Agent run identifier, recorded for provenance.
  run_id: z.string().max(200).optional(),
  // Token callers may declare 'import'; sessions are always 'manual'.
  source: z.enum(['agent', 'import']).optional(),
  // A completion meter lower than the latest prior reading is refused
  // unless the meter was replaced — same rule as a standalone reading.
  allow_decrease: z.boolean().optional(),
  // Policy-specific facts. REQUIRED per policy (missingCompletionFields):
  // expiry → issued_until; prepaid_meter → purchased_to; on_condition → a
  // finding or a next review. Missing → 400/409 needs_details, nothing written.
  issued_until: nullableDate(),          // expiry
  purchased_to: nullableNonNeg(),        // prepaid_meter
  finding: nullableString(),             // on_condition
  next_review_on: nullableDate(),        // on_condition
  next_review_meter: nullableNonNeg(),   // on_condition
});

// Seed evidence for an item: "last done on … at …". Creates or edits the
// item's single is_baseline log; the schedule re-derives when the baseline
// is the latest evidence. Never a reading row — a baseline meter is a fact
// about the service, not an odometer observation.
export const SetBaselineSchema = z.object({
  completed_on: z.string().date(),
  meter: nullableNonNeg(),
});

export const MaintenanceLogSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  completed_on: z.string().date(),
  meter_at_completion: nullableNonNeg(),
  notes: nullableString(),
  cost: nullableNonNeg(),
  source: z.enum(['manual', 'task', 'agent', 'import']),
  event_key: nullableString(),
  actor: nullableString(),
  run_id: nullableString(),
  reading_id: z.string().uuid().nullable().optional(),
  is_baseline: z.boolean(),
  issued_until: nullableDate(),
  purchased_to: nullableNonNeg(),
  finding: nullableString(),
  next_review_on: nullableDate(),
  next_review_meter: nullableNonNeg(),
  created_at: z.string().datetime({ offset: true }),
});

export const UpdateMaintenanceLogSchema = z.object({
  completed_on: z.string().date().optional(),
  // Follows through to the linked completion reading: null voids it, a
  // value corrects it (validated like any reading), a value on a log that
  // never had one creates it.
  meter_at_completion: nullableNonNeg(),
  notes: nullableString(),
  cost: nullableNonNeg(),
  allow_decrease: z.boolean().optional(),
});

export type Asset = z.infer<typeof AssetSchema>;
export type MeterReading = z.infer<typeof MeterReadingSchema>;
export type MaintenanceItem = z.infer<typeof MaintenanceItemSchema>;
export type MaintenanceLog = z.infer<typeof MaintenanceLogSchema>;
