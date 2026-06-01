import { z } from 'zod';

// ─── Sources + visit linkage ─────────────────────────────────────────────

export const HealthMetricSourceSchema = z.enum([
  'manual', 'garmin', 'apple_health', 'google_health', 'whoop', 'oura', 'other',
]);
export type HealthMetricSource = z.infer<typeof HealthMetricSourceSchema>;

export const WorkoutSourceSchema = z.enum([
  'manual', 'garmin', 'apple_health', 'google_health', 'whoop', 'strava', 'other',
]);
export type WorkoutSource = z.infer<typeof WorkoutSourceSchema>;

// ─── Visits ──────────────────────────────────────────────────────────────

export const VisitTypeSchema = z.enum([
  'annual', 'sick', 'specialist', 'follow_up', 'lab', 'imaging',
  'urgent_care', 'emergency', 'telehealth', 'other',
]);
export type VisitType = z.infer<typeof VisitTypeSchema>;

export const HealthVisitSchema = z.object({
  id: z.string().uuid(),
  visit_date: z.string().date(),
  provider_name: z.string().nullable().optional(),
  provider_specialty: z.string().nullable().optional(),
  visit_type: VisitTypeSchema.nullable().optional(),
  reason: z.string().nullable().optional(),
  assessment: z.string().nullable().optional(),
  plan: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  follow_up_date: z.string().date().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type HealthVisit = z.infer<typeof HealthVisitSchema>;

export const CreateHealthVisitSchema = z.object({
  visit_date: z.string().date(),
  provider_name: z.string().nullable().optional(),
  provider_specialty: z.string().nullable().optional(),
  visit_type: VisitTypeSchema.nullable().optional(),
  reason: z.string().nullable().optional(),
  assessment: z.string().nullable().optional(),
  plan: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  follow_up_date: z.string().date().nullable().optional(),
});

export const UpdateHealthVisitSchema = CreateHealthVisitSchema.partial();

// ─── Vitals + wearable metrics ───────────────────────────────────────────

export const HealthMetricSchema = z.object({
  id: z.string().uuid(),
  measured_at: z.string().datetime({ offset: true }),
  metric: z.string().min(1),
  value: z.number().nullable().optional(),
  value_secondary: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  source: HealthMetricSourceSchema,
  visit_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type HealthMetric = z.infer<typeof HealthMetricSchema>;

export const CreateHealthMetricSchema = z.object({
  measured_at: z.string().datetime({ offset: true }),
  metric: z.string().min(1),
  value: z.number().nullable().optional(),
  value_secondary: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  source: HealthMetricSourceSchema.optional(),
  visit_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const UpdateHealthMetricSchema = CreateHealthMetricSchema.partial();

// Common metric vocabulary. Free-form text so anything goes, but these
// are the canonical names the UI + parser + import paths use so charts
// can find them consistently.
export const COMMON_METRICS = [
  'weight',
  'bp',             // value=systolic, value_secondary=diastolic
  'hr_resting',
  'hr_avg',
  'hr_max',
  'sleep_duration', // minutes
  'sleep_score',
  'stress_avg',
  'body_battery_low',
  'body_battery_high',
  'spo2_avg',
  'respiration_rate',
  'hrv_overnight',
  'vo2_max',
  'steps',
  'calories_burned',
  'intensity_minutes',
  'temperature',
  'glucose',
] as const;

// ─── Labs ────────────────────────────────────────────────────────────────

export const LabResultFlagSchema = z.enum([
  'low', 'high', 'critical_low', 'critical_high', 'abnormal',
]);
export type LabResultFlag = z.infer<typeof LabResultFlagSchema>;

export const LabResultSchema = z.object({
  id: z.string().uuid(),
  panel_id: z.string().uuid(),
  analyte: z.string().min(1),
  value: z.number().nullable().optional(),
  value_text: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  reference_range_low: z.number().nullable().optional(),
  reference_range_high: z.number().nullable().optional(),
  reference_text: z.string().nullable().optional(),
  flag: LabResultFlagSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});
export type LabResult = z.infer<typeof LabResultSchema>;

export const CreateLabResultSchema = z.object({
  analyte: z.string().min(1),
  value: z.number().nullable().optional(),
  value_text: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  reference_range_low: z.number().nullable().optional(),
  reference_range_high: z.number().nullable().optional(),
  reference_text: z.string().nullable().optional(),
  flag: LabResultFlagSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const LabPanelSchema = z.object({
  id: z.string().uuid(),
  drawn_date: z.string().date(),
  panel_name: z.string().min(1),
  ordering_provider: z.string().nullable().optional(),
  lab_facility: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  visit_id: z.string().uuid().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type LabPanel = z.infer<typeof LabPanelSchema>;

export const CreateLabPanelSchema = z.object({
  drawn_date: z.string().date(),
  panel_name: z.string().min(1),
  ordering_provider: z.string().nullable().optional(),
  lab_facility: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  visit_id: z.string().uuid().nullable().optional(),
  // Allow the create payload to also seed initial results in one round-trip.
  results: z.array(CreateLabResultSchema).optional(),
});

export const UpdateLabPanelSchema = z.object({
  drawn_date: z.string().date().optional(),
  panel_name: z.string().min(1).optional(),
  ordering_provider: z.string().nullable().optional(),
  lab_facility: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  visit_id: z.string().uuid().nullable().optional(),
});

// ─── Wellbeing check-ins ─────────────────────────────────────────────────

export const WellbeingCheckInSchema = z.object({
  id: z.string().uuid(),
  checked_in_at: z.string().datetime({ offset: true }),
  mood: z.number().int().min(1).max(5).nullable().optional(),
  energy: z.number().int().min(1).max(5).nullable().optional(),
  sleep_quality: z.number().int().min(1).max(5).nullable().optional(),
  pain: z.number().int().min(0).max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});
export type WellbeingCheckIn = z.infer<typeof WellbeingCheckInSchema>;

export const CreateWellbeingCheckInSchema = z.object({
  checked_in_at: z.string().datetime({ offset: true }).optional(),
  mood: z.number().int().min(1).max(5).nullable().optional(),
  energy: z.number().int().min(1).max(5).nullable().optional(),
  sleep_quality: z.number().int().min(1).max(5).nullable().optional(),
  pain: z.number().int().min(0).max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
});

// ─── Medications + supplements + vitamins ────────────────────────────────

export const MedicationKindSchema = z.enum([
  'prescription', 'supplement', 'vitamin', 'otc',
]);
export type MedicationKind = z.infer<typeof MedicationKindSchema>;

export const MEDICATION_KIND_LABELS: Record<MedicationKind, string> = {
  prescription: 'Prescription',
  supplement: 'Supplement',
  vitamin: 'Vitamin',
  otc: 'OTC',
};

export const MedicationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  kind: MedicationKindSchema,
  dosage: z.string().nullable().optional(),
  frequency: z.string().nullable().optional(),
  prescribing_provider: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  start_date: z.string().date().nullable().optional(),
  stop_date: z.string().date().nullable().optional(),
  active: z.boolean(),
  notes: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Medication = z.infer<typeof MedicationSchema>;

export const CreateMedicationSchema = z.object({
  name: z.string().min(1),
  kind: MedicationKindSchema.optional(),
  dosage: z.string().nullable().optional(),
  frequency: z.string().nullable().optional(),
  prescribing_provider: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  start_date: z.string().date().nullable().optional(),
  stop_date: z.string().date().nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export const UpdateMedicationSchema = CreateMedicationSchema.partial();

// ─── Documents ───────────────────────────────────────────────────────────

export const DocumentTypeSchema = z.enum([
  'lab_report', 'imaging_report', 'visit_summary',
  'discharge_summary', 'prescription', 'vaccination_record',
  'insurance', 'other',
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const OcrStatusSchema = z.enum([
  'pending', 'parsed', 'reviewed', 'skipped',
]);

export const HealthDocumentSchema = z.object({
  id: z.string().uuid(),
  storage_path: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().nullable().optional(),
  document_type: DocumentTypeSchema.nullable().optional(),
  document_date: z.string().date().nullable().optional(),
  visit_id: z.string().uuid().nullable().optional(),
  panel_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  ocr_status: OcrStatusSchema.nullable().optional(),
  ocr_extracted: z.record(z.unknown()).nullable().optional(),
  uploaded_at: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// ─── Workouts ────────────────────────────────────────────────────────────

export const WorkoutSchema = z.object({
  id: z.string().uuid(),
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).nullable().optional(),
  duration_min: z.number().nullable().optional(),
  activity_type: z.string().nullable().optional(),
  distance_m: z.number().nullable().optional(),
  avg_hr: z.number().int().nullable().optional(),
  max_hr: z.number().int().nullable().optional(),
  calories: z.number().int().nullable().optional(),
  elevation_gain_m: z.number().nullable().optional(),
  pace_sec_per_km: z.number().nullable().optional(),
  power_avg_watts: z.number().nullable().optional(),
  source: WorkoutSourceSchema,
  notes: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});
export type Workout = z.infer<typeof WorkoutSchema>;

// ─── Health history (singleton) ──────────────────────────────────────────

export const HistoryEntrySchema = z.object({
  // Structured-but-loose JSON arrays. Validators are intentionally permissive
  // so the UI can evolve fields without schema churn.
  name: z.string().optional(),
  procedure: z.string().optional(),
  allergen: z.string().optional(),
  vaccine: z.string().optional(),
  relation: z.string().optional(),
  condition: z.string().optional(),
  date: z.string().optional(),
  diagnosed_date: z.string().optional(),
  status: z.string().optional(),
  hospital: z.string().optional(),
  reaction: z.string().optional(),
  severity: z.string().optional(),
  notes: z.string().optional(),
}).passthrough();

export const HealthHistorySchema = z.object({
  id: z.literal(true),
  narrative: z.string().nullable().optional(),
  conditions: z.array(HistoryEntrySchema).default([]),
  surgeries: z.array(HistoryEntrySchema).default([]),
  allergies: z.array(HistoryEntrySchema).default([]),
  immunizations: z.array(HistoryEntrySchema).default([]),
  family_history: z.array(HistoryEntrySchema).default([]),
  updated_at: z.string().datetime({ offset: true }),
});
export type HealthHistory = z.infer<typeof HealthHistorySchema>;

export const UpdateHealthHistorySchema = z.object({
  narrative: z.string().nullable().optional(),
  conditions: z.array(HistoryEntrySchema).optional(),
  surgeries: z.array(HistoryEntrySchema).optional(),
  allergies: z.array(HistoryEntrySchema).optional(),
  immunizations: z.array(HistoryEntrySchema).optional(),
  family_history: z.array(HistoryEntrySchema).optional(),
});
