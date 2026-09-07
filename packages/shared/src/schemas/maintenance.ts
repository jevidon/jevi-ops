import { z } from 'zod';
import { MAINTENANCE_POLICIES } from '../maintenance.js';

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

export const AssetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  kind: AssetKindSchema,
  domain_id: z.string().uuid().nullable().optional(),
  // Free text ('km','mi','hours'…). Null = date-only asset.
  meter_unit: nullableString(),
  // Schemaless per-asset facts (VIN, rego, insurance, warranty…).
  metadata: z.record(z.string(), z.unknown()),
  notes: nullableString(),
  lifecycle: AssetLifecycleSchema,
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
});

export const UpdateAssetSchema = CreateAssetSchema.partial().extend({
  lifecycle: AssetLifecycleSchema.optional(),
  // Archive/unarchive goes through the same PATCH (routines precedent).
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
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
  // Policy-specific facts.
  issued_until: nullableDate(),          // expiry
  purchased_to: nullableNonNeg(),        // prepaid_meter
  finding: nullableString(),             // on_condition
  next_review_on: nullableDate(),        // on_condition
  next_review_meter: nullableNonNeg(),   // on_condition
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
  meter_at_completion: nullableNonNeg(),
  notes: nullableString(),
  cost: nullableNonNeg(),
});

export type Asset = z.infer<typeof AssetSchema>;
export type MeterReading = z.infer<typeof MeterReadingSchema>;
export type MaintenanceItem = z.infer<typeof MaintenanceItemSchema>;
export type MaintenanceLog = z.infer<typeof MaintenanceLogSchema>;
