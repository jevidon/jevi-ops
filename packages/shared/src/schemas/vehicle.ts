import { z } from 'zod';

// These are metadata conventions on assets, never another vehicle store.
// Scalar facts retain their original representation, including provenance.
const text = z.string().min(1).max(1000);
export const VehicleEvidenceSchema = z.object({
  source: z.string().nullable().optional(),
  source_kind: z.enum(['user', 'document', 'official', 'research', 'import', 'unknown']).optional(),
  source_id: z.string().uuid().optional(),
  recorded_at: z.string().datetime({ offset: true }).optional(),
  observed_on: z.string().date().nullable().optional(),
  effective_on: z.string().date().nullable().optional(),
  verified: z.boolean().optional(),
  confidence: z.enum(['reported', 'documented', 'verified', 'uncertain']).optional(),
}).passthrough();

function fact<T extends z.ZodTypeAny>(value: T) {
  return z.union([value, VehicleEvidenceSchema.extend({ value })]).nullable().optional();
}

export const VehiclePreferencesSchema = z.object({
  goals: z.array(z.enum(['service_reminders', 'maintain_records', 'learn_maintenance', 'plan_improvements'])).optional(),
  practical_involvement: z.enum(['service_provider', 'simple_checks', 'some_diy', 'mostly_diy', 'unknown']).optional(),
  confidence: z.enum(['new', 'basics', 'experienced', 'unknown']).optional(),
  detail: z.enum(['essentials', 'balanced', 'detailed', 'unknown']).optional(),
  improvement_interest: z.enum(['none_now', 'maybe_later', 'actively_planning', 'unknown']).optional(),
}).strict();

export const VehicleAnswerStateSchema = z.enum(['not_asked', 'known', 'unknown', 'deferred', 'not_applicable']);
export const VehicleAnswerStatesSchema = z.object({
  fields: z.record(z.string().min(1), VehicleAnswerStateSchema).optional(),
  deferred_sections: z.array(z.string().min(1)).optional(),
  known_gaps: z.array(z.string().min(1).max(2000)).optional(),
}).strict();

export const VehicleInstalledEquipmentSchema = z.array(z.object({
  name: text,
  description: z.string().max(10_000).optional(),
  installed_on: z.string().date().optional(),
  evidence: VehicleEvidenceSchema.optional(),
}).strict());

export const VehicleKnownIssuesSchema = z.array(z.object({
  description: z.string().min(1).max(10_000),
  status: z.enum(['open', 'monitoring', 'resolved']).optional(),
  observed_on: z.string().date().optional(),
  evidence: VehicleEvidenceSchema.optional(),
}).strict());

// Approximate evidence never changes the exact-date/purchased-meter keys.
export const VehiclePartialDateSchema = z.discriminatedUnion('precision', [
  z.object({ precision: z.literal('day'), value: z.string().date() }),
  z.object({ precision: z.literal('month'), value: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  z.object({ precision: z.literal('year'), value: z.string().regex(/^\d{4}$/) }),
  z.object({ precision: z.literal('unknown') }),
]);
export const VehicleOwnershipEvidenceSchema = z.object({
  purchase_date: VehiclePartialDateSchema.optional(),
  first_registration_date: VehiclePartialDateSchema.optional(),
  purchase_reading: z.object({ amount: z.number().finite().nonnegative(), unit: z.enum(['km', 'mi']) }).optional(),
  evidence: VehicleEvidenceSchema.optional(),
}).strict();

export const VehicleMetadataSchema = z.object({
  year: fact(z.number().int().min(1886).max(2200)),
  make: fact(text),
  model: fact(text),
  variant: fact(text),
  year_basis: fact(z.enum(['model_year', 'manufacture_year', 'first_registration_year', 'unknown'])),
  vin: fact(text),
  chassis_id: fact(text),
  model_code: fact(text),
  plate: fact(text),
  based_country: fact(z.string().regex(/^[A-Z]{2}$/)),
  based_region: fact(text),
  registration_country: fact(z.string().regex(/^[A-Z]{2}$/)),
  registration_region: fact(text),
  fuel_powertrain: fact(text),
  engine: fact(text),
  registration_class: fact(text),
  import_origin: fact(text),
  first_registered: fact(z.string().date()),
  purchased_on: fact(z.string().date()),
  purchased_meter: fact(z.number().finite().nonnegative()),
  usage: fact(text),
  location: fact(text),
  history_coverage: fact(z.enum(['none', 'partial', 'extensive', 'unknown'])),
  vehicle_preferences: VehiclePreferencesSchema.nullable().optional(),
  installed_equipment: VehicleInstalledEquipmentSchema.nullable().optional(),
  known_issues: VehicleKnownIssuesSchema.nullable().optional(),
  vehicle_answer_states: VehicleAnswerStatesSchema.nullable().optional(),
  vehicle_ownership_evidence: VehicleOwnershipEvidenceSchema.nullable().optional(),
}).passthrough();
export type VehicleMetadata = z.infer<typeof VehicleMetadataSchema>;
export type VehiclePreferences = z.infer<typeof VehiclePreferencesSchema>;
export const VEHICLE_METADATA_KEYS = Object.keys(VehicleMetadataSchema.shape) as Array<keyof typeof VehicleMetadataSchema.shape>;

// The wizard alone requires these identity facts. Trim uses the existing
// variant key; unknown trim is represented by its answer state.
export const VehicleIdentitySchema = z.object({
  year: z.number().int().min(1886).max(2200),
  make: z.string().trim().min(1).max(1000),
  model: z.string().trim().min(1).max(1000),
  variant: z.string().trim().min(1).max(1000).nullable().optional(),
  nickname: z.string().trim().min(1).max(1000).optional(),
  year_basis: z.enum(['model_year', 'manufacture_year', 'first_registration_year', 'unknown']).optional(),
  vin: text.optional(),
  chassis_id: text.optional(),
  model_code: text.optional(),
  plate: text.optional(),
});
export type VehicleIdentity = z.infer<typeof VehicleIdentitySchema>;

export function vehicleDisplayName(identity: VehicleIdentity): string {
  return identity.nickname ?? [identity.year, identity.make, identity.model, identity.variant].filter(Boolean).join(' ');
}

// Validate only keys being changed: an unrelated edit must preserve legacy
// metadata exactly even if a historical value predates today's convention.
export function validateVehicleMetadataKeys(metadata: Record<string, unknown>, keys = Object.keys(metadata)): void {
  const issues: z.ZodIssue[] = [];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(VehicleMetadataSchema.shape, key)) continue;
    const schema = VehicleMetadataSchema.shape[key as keyof typeof VehicleMetadataSchema.shape];
    const parsed = schema.safeParse(metadata[key]);
    if (!parsed.success) issues.push(...parsed.error.issues.map((issue) => ({ ...issue, path: [key, ...issue.path] })));
  }
  if (issues.length) throw new z.ZodError(issues);
}
