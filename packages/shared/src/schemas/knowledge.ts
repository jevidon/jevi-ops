import { z } from 'zod';
import { CreateMaintenanceItemSchema, MetadataPatchSchema, UpdateMaintenanceItemSchema } from './maintenance.js';

const instant = z.string().datetime({ offset: true });
const ids = z.array(z.string().uuid()).max(100);
export const ResponsibilityKindSchema = z.enum(['user_reminder', 'service_recommendation', 'regulatory']);
export const ResponsibilityVersionStatusSchema = z.enum(['proposed', 'accepted', 'withdrawn']);
export const KnowledgeEffectiveTimeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('instant'), at: instant }).strict(),
  z.object({ kind: z.literal('date'), date: z.string().date(), timezone: z.string().min(1).max(100).optional() }).strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
]);
export type KnowledgeEffectiveTime = z.infer<typeof KnowledgeEffectiveTimeSchema>;

export const ResponsibilityVersionInputSchema = z.object({
  creation_key: z.string().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(1000),
  kind: ResponsibilityKindSchema,
  scope: z.object({ country: z.string().regex(/^[A-Z]{2}$/).optional(), region: z.string().max(1000).optional(), description: z.string().max(10_000).optional() }).strict().optional(),
  status: ResponsibilityVersionStatusSchema.default('accepted'),
  source_ids: ids.default([]),
  source_note: z.string().trim().max(20_000).optional(),
  published_at: instant.nullable().optional(),
  retrieved_at: instant.nullable().optional(),
  effective_from: KnowledgeEffectiveTimeSchema.optional(),
  effective_until: KnowledgeEffectiveTimeSchema.optional(),
  reason: z.string().trim().min(1).max(20_000),
}).strict();
export const ReviseResponsibilitySchema = ResponsibilityVersionInputSchema.extend({ expected_version: z.number().int().positive() });
export type ResponsibilityVersionInput = z.input<typeof ResponsibilityVersionInputSchema>;

export const ApplicabilitySchema = z.enum(['unknown', 'applicable', 'not_applicable']);
export const KnowledgeEvidenceBasisSchema = z.enum(['user_reported', 'document_supported', 'official_source_supported']);
export const KnowledgeReviewStateSchema = z.enum(['unreviewed', 'accepted', 'needs_review']);
export const AssessmentInputSchema = z.object({
  applicability: ApplicabilitySchema,
  evidence_basis: KnowledgeEvidenceBasisSchema.default('user_reported'),
  review_state: KnowledgeReviewStateSchema.default('accepted'),
  rationale: z.string().trim().min(1).max(20_000),
  relevant_fact_keys: z.array(z.string().min(1).max(100)).max(100).default([]),
  source_ids: ids.default([]),
  assessed_at: instant.optional(),
  last_checked_at: instant.nullable().optional(),
  review_due_at: instant.nullable().optional(),
}).strict();

const checkedFactsPatch = MetadataPatchSchema.superRefine((patch, ctx) => {
  for (const section of ['set', 'unset'] as const) {
    for (const [key, entry] of Object.entries(patch[section] ?? {})) {
      if (entry.expected === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [section, key, 'expected'], message: 'Every accepted fact operation requires its previously observed value (null for absent).' });
    }
  }
});
export const KnowledgeTrackingChangeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), item: CreateMaintenanceItemSchema }).strict(),
  z.object({ action: z.literal('update'), item_id: z.string().uuid(), patch: UpdateMaintenanceItemSchema }).strict(),
  z.object({ action: z.literal('link'), item_id: z.string().uuid() }).strict(),
]);
export const KnowledgeChangeSchema = z.object({
  asset_id: z.string().uuid(),
  rule_version_id: z.string().uuid(),
  assessment: AssessmentInputSchema,
  facts_patch: checkedFactsPatch.optional(),
  tracking: KnowledgeTrackingChangeSchema.optional(),
  reason: z.string().trim().min(1).max(20_000),
  // Omitted applies now after confirmation. An explicit unknown time retains
  // approved pending knowledge without authorising automatic activation.
  effective: KnowledgeEffectiveTimeSchema.optional(),
}).strict();
export type KnowledgeChange = z.infer<typeof KnowledgeChangeSchema>;
export type KnowledgeChangeInput = z.input<typeof KnowledgeChangeSchema>;

export const AcceptKnowledgeChangeSchema = z.object({
  preview_id: z.string().uuid(),
  operation_key: z.string().min(1).max(200),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export const KnowledgeTransitionStatusSchema = z.enum(['pending', 'applied', 'needs_review', 'cancelled', 'superseded']);
export type KnowledgeTransitionStatus = z.infer<typeof KnowledgeTransitionStatusSchema>;
export const CancelKnowledgeTransitionSchema = z.object({
  expected_revision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(20_000),
  status: z.enum(['cancelled', 'superseded']).default('cancelled'),
}).strict();
export const KnowledgeFollowupSchema = z.object({ title: z.string().trim().min(1).max(1000).optional() }).strict();

export interface KnowledgePreconditions {
  scheduling: { timezone: string; staleDays: number } | null;
  asset: { id: string; lifecycle: string; domain_id: string | null; meter_unit: string | null; updated_at: string; facts: Record<string, unknown> };
  rule: { id: string; current_version: number; version_id: string; status: string };
  sources: Array<{ id: string; content_hash: string }>;
  assessment: Record<string, unknown> | null;
  item: Record<string, unknown> | null;
  task: Record<string, unknown> | null;
  reading_fingerprint: string;
  item_evidence_fingerprint: string | null;
  task_context_fingerprint: string | null;
}
export interface KnowledgePreviewChange {
  kind: 'facts' | 'assessment' | 'tracking' | 'effective_time';
  label: string;
  before?: unknown;
  after?: unknown;
}
export interface KnowledgeReceipt {
  asset_id: string;
  assessment_id?: string;
  assessment_revision?: number;
  item_id?: string | null;
  transition_id?: string;
  status: 'applied' | 'pending';
  applied_at?: string;
}
