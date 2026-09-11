import { z } from 'zod';
import { AssessmentInputSchema, KnowledgeEffectiveTimeSchema, KnowledgeTrackingChangeSchema, ResponsibilityVersionInputSchema } from './knowledge.js';

export const RESEARCH_WORKER_SCOPES = ['research:claim', 'research:context', 'research:heartbeat', 'research:result', 'research:status', 'research:health'] as const;
export const ResearchWorkerScopeSchema = z.enum(RESEARCH_WORKER_SCOPES);
export type ResearchWorkerScope = z.infer<typeof ResearchWorkerScopeSchema>;
export const ResearchTaskTypeSchema = z.enum(['vehicle_question', 'responsibility_review', 'source_verification']);
export const ResearchWorkerInputSchema = z.object({
  name: z.string().trim().min(1).max(100), adapter: z.string().min(1).max(100), adapter_version: z.string().min(1).max(200),
  capabilities: z.array(z.enum(['external_search', 'external_fetch', 'document_extraction'])).max(3),
  allowed_task_types: z.array(ResearchTaskTypeSchema).min(1).max(3), enabled: z.boolean().default(true),
}).strict();
export const ResearchWorkerHealthSchema = z.object({
  adapter_version: z.string().min(1).max(200), capabilities: z.array(z.enum(['external_search', 'external_fetch', 'document_extraction'])).max(3),
  ready: z.boolean(), configuration_verified: z.boolean().optional(), detail: z.string().max(2000).optional(),
}).strict();

export const ResearchJobInputSchema = z.object({
  review_assessment_ids: z.array(z.string().uuid()).max(100).default([]),
  authorized_source_ids: z.array(z.string().uuid()).max(20).default([]),
  source_result_id: z.string().uuid().optional(), allow_proposals: z.boolean().default(true),
  operation_key: z.string().min(1).max(200), asset_id: z.string().uuid(),
  worker_id: z.string().uuid().optional(), task_type: ResearchTaskTypeSchema.default('vehicle_question'),
  question: z.string().trim().min(1).max(20_000),
  allowed_domains: z.array(z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/)).min(1).max(30),
  budget: z.object({ timeout_seconds: z.number().int().min(10).max(3600).default(300), max_sources: z.number().int().min(1).max(10).default(5), max_requests: z.number().int().min(0).max(100).default(20) }).default({}),
  max_attempts: z.number().int().min(1).max(5).default(3),
}).strict();
export type ResearchJobInput = z.input<typeof ResearchJobInputSchema>;
export type ResearchJobRequest = z.infer<typeof ResearchJobInputSchema>;
export const ResearchLeaseSchema = z.object({ run_id: z.string().uuid(), lease_token: z.string().min(20).max(200) }).strict();
export const ResearchClaimSchema = z.object({}).strict();
export const ResearchFailureSchema = ResearchLeaseSchema.extend({ reason: z.string().min(1).max(2000), retryable: z.boolean().default(false) });

export const ResearchProfileKeySchema = z.enum(['year', 'year_basis', 'make', 'model', 'variant', 'engine', 'fuel_powertrain', 'registration_class', 'import_origin', 'based_country', 'based_region', 'registration_country', 'registration_region']);
const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);
const citations = z.array(z.string().min(1).max(100)).min(1).max(20);
export const ResearchOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('profile_facts'), facts: z.array(z.object({ key: ResearchProfileKeySchema, expected: scalar.nullable(), value: scalar }).strict()).min(1).max(20), citation_ids: citations, reason: z.string().min(1).max(10_000) }).strict(),
  z.object({ type: z.literal('document'), body: z.string().max(200_000), expected_version: z.number().int().positive(), citation_ids: citations, reason: z.string().min(1).max(10_000) }).strict(),
  z.object({
    type: z.literal('knowledge'), rule_version_id: z.string().uuid().optional(),
    new_rule: ResponsibilityVersionInputSchema.omit({ source_ids: true, creation_key: true }).optional(),
    assessment: AssessmentInputSchema.omit({ source_ids: true }), tracking: KnowledgeTrackingChangeSchema.optional(),
    effective: KnowledgeEffectiveTimeSchema.optional(), citation_ids: citations, reason: z.string().min(1).max(10_000),
  }).strict(),
]);
export type ResearchOperation = z.infer<typeof ResearchOperationSchema>;
export const ResearchFetchedSourceSchema = z.object({
  citation_id: z.string().min(1).max(100), url: z.string().url().max(4000), publisher: z.string().min(1).max(1000), title: z.string().min(1).max(1000),
  retrieved_at: z.string().datetime({ offset: true }), published_at: z.string().datetime({ offset: true }).optional(),
  effective: KnowledgeEffectiveTimeSchema.optional(), content: z.string().min(1).max(200_000), content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  supporting_locations: z.array(z.object({ location: z.string().min(1).max(1000), excerpt: z.string().min(1).max(4000) }).strict()).min(1).max(20),
}).strict();
export const ResearchResultSchema = ResearchLeaseSchema.extend({
  operation_key: z.string().min(1).max(200), outcome: z.enum(['findings', 'no_supported_change', 'insufficient_evidence']),
  checked_assessment_ids: z.array(z.string().uuid()).max(100).default([]),
  summary: z.string().min(1).max(20_000), sources: z.array(ResearchFetchedSourceSchema).max(10),
  claims: z.array(z.object({ kind: z.enum(['fact', 'interpretation', 'recommendation', 'open_question']), statement: z.string().min(1).max(10_000), citation_ids: z.array(z.string().min(1).max(100)).max(20) }).strict()).max(100),
  proposed_changes: z.array(ResearchOperationSchema).max(10).default([]), missing_facts: z.array(ResearchProfileKeySchema).max(20).default([]),
  uncertainty: z.array(z.string().min(1).max(4000)).max(30).default([]), checked_question: z.boolean(),
}).superRefine((result, ctx) => {
  const known = new Set(result.sources.map((s) => s.citation_id));
  if (known.size !== result.sources.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sources'], message: 'Citation IDs must be unique.' });
  for (const [index, claim] of result.claims.entries()) {
    if (claim.kind !== 'open_question' && !claim.citation_ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['claims', index], message: 'A supported claim requires a retained citation.' });
    if (claim.citation_ids.some((id) => !known.has(id))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['claims', index], message: 'Every citation must resolve to supplied fetched evidence.' });
  }
  for (const [index, operation] of result.proposed_changes.entries()) {
    if (operation.citation_ids.some((id) => !known.has(id))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['proposed_changes', index], message: 'Every proposal citation must resolve to supplied fetched evidence.' });
    if (operation.type === 'knowledge' && (!!operation.rule_version_id === !!operation.new_rule)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['proposed_changes', index], message: 'Choose exactly one existing rule version or new responsibility reference.' });
  }
  if (result.outcome !== 'findings' && result.proposed_changes.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['proposed_changes'], message: 'Only sourced findings may propose changes.' });
  const allFactKeys = result.proposed_changes.flatMap((operation) => operation.type === 'profile_facts' ? operation.facts.map((fact) => fact.key) : []);
  if (new Set(allFactKeys).size !== allFactKeys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['proposed_changes'], message: 'Each profile fact may be proposed only once per result.' });
  if (result.proposed_changes.filter((operation) => operation.type === 'document').length > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['proposed_changes'], message: 'Only one document amendment may be proposed per result.' });
  if (result.outcome !== 'insufficient_evidence' && (!result.sources.length || !result.checked_question || !result.claims.some((claim) => claim.kind !== 'open_question' && claim.citation_ids.length))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['outcome'], message: 'A successful substantive check requires actual retained sources and question coverage.' });
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
export type ResearchResultInput = z.input<typeof ResearchResultSchema>;
export const ReviewResearchProposalSchema = z.object({ expected_revision: z.number().int().positive(), operation_key: z.string().min(1).max(200), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export const RejectResearchProposalSchema = z.object({ expected_revision: z.number().int().positive(), reason: z.string().min(1).max(10_000) }).strict();
