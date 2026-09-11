import { z } from 'zod';
import { OnboardingDraftSchema } from './onboarding.js';
import { AssetLifecycleSchema, MaintenancePolicySchema } from './maintenance.js';
import { VehiclePreferencesSchema, VehicleAnswerStatesSchema, VehicleInstalledEquipmentSchema, VehicleKnownIssuesSchema, VehicleEvidenceSchema } from './vehicle.js';

const text = z.string().max(1000).optional();
const amount = z.number().finite().nonnegative().nullable().optional();
const date = z.string().date().nullable().optional();
const ownershipDraft = z.object({
  purchase_date: z.object({ precision: z.enum(['day', 'month', 'year', 'unknown']), value: z.string().max(10).optional() }).strict().optional(),
  first_registration_date: z.object({ precision: z.enum(['day', 'month', 'year', 'unknown']), value: z.string().max(10).optional() }).strict().optional(),
  purchase_reading: z.object({ amount: z.number().finite().nonnegative(), unit: z.enum(['km', 'mi']).nullable().optional() }).strict().optional(),
  evidence: VehicleEvidenceSchema.optional(),
}).strict();
export const VehicleTrackingDraftSchema = z.object({
  key: z.string().min(1).max(100), name: z.string().max(1000),
  kind: z.enum(['user_reminder', 'service_recommendation', 'regulatory']).default('user_reminder'),
  applicability: z.enum(['unknown', 'applicable', 'not_applicable']).default('unknown'),
  evidence_basis: z.enum(['user_reported', 'document_supported', 'official_source_supported']).default('user_reported'),
  source_ids: z.array(z.string().uuid()).max(100).default([]), source_note: z.string().max(20000).default(''),
  policy: MaintenancePolicySchema.default('expiry'),
  interval_days: z.number().int().positive().nullable().optional(), interval_months: z.number().int().positive().nullable().optional(),
  interval_meter: z.number().positive().nullable().optional(), next_due_date: date, next_due_meter: amount,
  lead_days: z.number().int().nonnegative().optional(), lead_meter: amount, track: z.boolean().default(true),
}).strict();
export const VehicleOnboardingDraftSchema = OnboardingDraftSchema.pipe(z.object({
  preferences: VehiclePreferencesSchema.optional(),
  identity: z.object({ year: z.number().int().min(1886).max(2200).nullable().optional(), make: text, model: text,
    variant: text, nickname: text, year_basis: z.enum(['model_year', 'manufacture_year', 'first_registration_year', 'unknown']).optional(),
    vin: text, chassis_id: text, model_code: text, plate: text,
    reading: amount, meter_unit: z.enum(['km', 'mi']).nullable().optional(), recorded_on: date,
  }).strict().optional(),
  jurisdiction: z.object({ based_country: z.string().max(2).optional(), based_region: text,
    registration_country: z.string().max(2).optional(), registration_region: text,
  }).strict().optional(),
  state: z.object({ lifecycle: AssetLifecycleSchema.optional(), fuel_powertrain: text, engine: text,
    registration_class: text, import_origin: text, condition: z.string().max(10000).optional(),
    configuration: z.enum(['standard', 'modified', 'unknown']).optional(), ownership: ownershipDraft.optional(),
    installed_equipment: VehicleInstalledEquipmentSchema.optional(), known_issues: VehicleKnownIssuesSchema.optional(),
  }).strict().optional(),
  history: z.object({ coverage: z.enum(['none', 'partial', 'extensive', 'unknown']).optional(), notes: z.string().max(20000).optional() }).strict().optional(),
  plans: z.object({ usage: z.string().max(1000).optional(), estimated_usage: z.string().max(1000).optional(), domain_id: z.string().uuid().nullable().optional(),
    projects: z.array(z.object({ key: z.string().min(1).max(100), name: z.string().max(1000),
      state: z.enum(['idea', 'ordered', 'approved']).default('idea'), description: z.string().max(20000).optional(),
    }).strict()).max(50).optional(),
  }).strict().optional(),
  tracking: z.object({ items: z.array(VehicleTrackingDraftSchema).max(100).optional(), deferred: z.boolean().optional() }).strict().optional(),
  review: z.object({
    // OnboardingDraftSchema enforces JSON, and the framework makes this
    // server-captured context immutable across client saves.
    baseline: z.record(z.any()), answer_states: VehicleAnswerStatesSchema.optional(), doc_md: z.string().max(200000).nullable().optional(),
  }).strict(),
}).strict());
export type VehicleOnboardingDraft = z.infer<typeof VehicleOnboardingDraftSchema>;
export type VehicleTrackingDraft = z.infer<typeof VehicleTrackingDraftSchema>;
