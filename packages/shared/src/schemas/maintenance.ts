import { z } from 'zod';

// Maintenance module (migration 0047) — wire shapes for /api/assets and
// /api/maintenance. Cadence semantics live in ../maintenance.ts (re-anchor
// from completion, whichever-first over date + meter axes).

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
  created_at: z.string().datetime({ offset: true }),
});

export const CreateMeterReadingSchema = z.object({
  reading: z.number().nonnegative(),
  // Omit → server defaults to today in app tz.
  recorded_on: z.string().date().optional(),
  notes: nullableString(),
});

export const MaintenanceDueStatusSchema = z.enum(['ok', 'due_soon', 'due', 'overdue']);

// Computed per-item on the wire by shared maintenanceDueState().
export const MaintenanceDueStateSchema = z.object({
  status: MaintenanceDueStatusSchema,
  trigger: z.enum(['date', 'meter']).nullable(),
  days_until: z.number().int().nullable(),
  meter_remaining: z.number().nullable(),
});

export const MaintenanceItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  notes: nullableString(),
  asset_id: z.string().uuid().nullable().optional(),
  domain_id: z.string().uuid(),
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
  asset: AssetSchema.pick({ id: true, name: true, kind: true, meter_unit: true }).nullable().optional(),
  latest_reading: z.number().nullable().optional(),
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
    // Omit → server inherits the asset's domain, else Inbox.
    domain_id: z.string().uuid().optional(),
    ...cadenceFields,
    // Seed history ("last replaced 2026-06-01 at 95,000 km") so next-due
    // computes from reality…
    last_completed_on: nullableDate(),
    last_completed_meter: nullableNonNeg(),
    // …or override next-due directly ("brakes due at 150,000 km") without
    // inventing a fake completion.
    next_due_date: nullableDate(),
    next_due_meter: nullableNonNeg(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) => v.interval_days != null || v.interval_months != null || v.interval_meter != null,
    { message: 'At least one of interval_days, interval_months, interval_meter is required.' },
  )
  .refine((v) => v.interval_days == null || v.interval_months == null, {
    message: 'Use interval_days or interval_months, not both.',
  });

export const UpdateMaintenanceItemSchema = z
  .object({
    name: z.string().min(1).optional(),
    notes: nullableString(),
    asset_id: z.string().uuid().nullable().optional(),
    domain_id: z.string().uuid().optional(),
    ...cadenceFields,
    next_due_date: nullableDate(),
    next_due_meter: nullableNonNeg(),
    active: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  // The XOR check runs server-side against the merged row — a patch alone
  // can't see the other interval column.
  ;

export const CompleteMaintenanceSchema = z.object({
  // Omit → today in app tz.
  completed_on: z.string().date().optional(),
  meter: z.number().nonnegative().nullable().optional(),
  notes: nullableString(),
  cost: z.number().nonnegative().nullable().optional(),
});

export const MaintenanceLogSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  completed_on: z.string().date(),
  meter_at_completion: nullableNonNeg(),
  notes: nullableString(),
  cost: nullableNonNeg(),
  source: z.enum(['manual', 'task', 'agent', 'import']),
  created_at: z.string().datetime({ offset: true }),
});

export type Asset = z.infer<typeof AssetSchema>;
export type MeterReading = z.infer<typeof MeterReadingSchema>;
export type MaintenanceItem = z.infer<typeof MaintenanceItemSchema>;
export type MaintenanceLog = z.infer<typeof MaintenanceLogSchema>;
