import { z } from 'zod';

export type OnboardingJson = null | boolean | number | string | OnboardingJson[] | { [key: string]: OnboardingJson };
export type OnboardingDraft = Record<string, Record<string, OnboardingJson>>;
const JsonSchema: z.ZodType<OnboardingJson> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string().max(100_000),
  z.array(JsonSchema).max(1000), z.record(JsonSchema),
]));

/** Drafts are never a credential transport. Provider credentials use settings only. */
export const OnboardingDraftSchema = z.record(z.record(JsonSchema)).superRefine((draft, ctx) => {
  const visit = (value: OnboardingJson, path: (string | number)[], depth: number) => {
    if (depth > 20) { ctx.addIssue({ code: 'custom', message: 'Draft nesting is too deep', path }); return; }
    if (typeof value === 'string' && (/(?:Bearer\s+\S+|\b(?:sk-|ops_)[A-Za-z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY-----)/i.test(value)
      || /https?:\/\/[^\s/]+:[^\s/]+@/i.test(value)
      || /[?&](?:api[_-]?key|token|secret|password|signature)=/i.test(value))) {
      ctx.addIssue({ code: 'custom', message: 'Credentials must be saved through Settings', path });
    }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|client[_-]?secret|credential)$/i.test(key)) {
        ctx.addIssue({ code: 'custom', message: 'Credentials must be saved through Settings', path: [...path, key] });
      } else visit(child, [...path, key], depth + 1);
    }
  };
  visit(draft, [], 0);
  if (JSON.stringify(draft).length > 500_000) ctx.addIssue({ code: 'custom', message: 'Draft is too large' });
});

export const OnboardingModuleIdSchema = z.enum(['core', 'vehicle']);
export const OnboardingStatusSchema = z.enum(['in_progress', 'deferred', 'completed', 'abandoned']);
export const OnboardingStepStateSchema = z.enum(['not_started', 'draft', 'confirmed', 'skipped']);
export const AnswerStateSchema = z.enum(['known', 'unknown', 'not_applicable', 'not_asked', 'deferred']);
export type AnswerState = z.infer<typeof AnswerStateSchema>;
export const OnboardingEntryPointSchema = z.enum(['first_run', 'settings', 'add_asset', 'asset_detail']);
export const OnboardingStepDefinitionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/), title: z.string(),
  description: z.string().optional(), optional: z.boolean().optional(),
});
export const OnboardingModuleDefinitionSchema = z.object({
  id: OnboardingModuleIdSchema, version: z.number().int().positive(), title: z.string(),
  entry_points: z.array(OnboardingEntryPointSchema), steps: z.array(OnboardingStepDefinitionSchema).min(1),
});
export type OnboardingModuleDefinition = z.infer<typeof OnboardingModuleDefinitionSchema>;
export type OnboardingStepDefinition = z.infer<typeof OnboardingStepDefinitionSchema>;
export type OnboardingStepState = z.infer<typeof OnboardingStepStateSchema>;
export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;

export interface OnboardingCapability {
  id: 'manual_forms' | 'text_generation' | 'structured_interpretation' | 'transcription' | 'document_extraction' | 'external_research' | 'active_monitoring';
  status: 'unavailable' | 'configured' | 'tested' | 'degraded';
  detail: string;
  last_success_at?: string | null;
}
export interface OnboardingChange { kind: string; label: string; before?: OnboardingJson; after?: OnboardingJson }
export interface OnboardingPreview {
  revision: number;
  fingerprint: string;
  changes: OnboardingChange[];
  preconditions: Record<string, OnboardingJson>;
  action_id?: string;
}
export interface OnboardingReceipt {
  operation_key: string;
  preview_fingerprint: string;
  expected_revision: number;
  completed_at: string;
  result: Record<string, OnboardingJson>;
}
export interface OnboardingSession {
  id: string;
  owner_id: string;
  creation_key: string;
  module_id: 'core' | 'vehicle';
  module_version: number;
  subject_id: string | null;
  parent_session_id: string | null;
  status: OnboardingStatus;
  current_step_id: string;
  step_states: Record<string, OnboardingStepState>;
  draft: OnboardingDraft;
  revision: number;
  preview: OnboardingPreview | null;
  commit_operation_key: string | null;
  commit_receipt: OnboardingReceipt | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
export interface InstallationSetup {
  state: 'eligible' | 'opt_in' | 'in_progress' | 'deferred' | 'completed';
  core_session_id: string | null;
  updated_at: string;
}

const OperationKey = z.string().min(8).max(160).regex(/^[a-zA-Z0-9:_-]+$/);
export const StartOnboardingSchema = z.object({
  module_id: OnboardingModuleIdSchema,
  creation_key: OperationKey,
  entry_point: OnboardingEntryPointSchema,
  subject_id: z.string().uuid().nullable().optional(),
  parent_session_id: z.string().uuid().nullable().optional(),
  draft: OnboardingDraftSchema.optional(),
}).strict();
export const SaveOnboardingStepSchema = z.object({
  expected_revision: z.number().int().nonnegative(),
  values: z.record(JsonSchema),
  state: OnboardingStepStateSchema.default('draft'),
  current_step_id: z.string().optional(),
}).strict();
export const OnboardingRevisionSchema = z.object({ expected_revision: z.number().int().nonnegative() }).strict();
export const CompleteOnboardingSchema = z.object({
  expected_revision: z.number().int().nonnegative(), operation_key: OperationKey,
  preview_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
