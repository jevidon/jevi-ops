import { z } from 'zod';
import { OnboardingDraftSchema, type OnboardingCapability, type OnboardingReceipt } from './onboarding.js';

export const CoreDomainChoiceSchema = z.object({
  key: z.string().min(1).max(100), name: z.string().trim().max(120),
  description: z.string().max(2000).optional(), existing_id: z.string().uuid().nullable().optional(),
  selected: z.boolean().default(true),
}).strict();
export const CoreAreaChoiceSchema = z.object({
  key: z.string().min(1).max(100), name: z.string().trim().max(120),
  domain_key: z.string().nullable().optional(), existing_id: z.string().uuid().nullable().optional(),
  selected: z.boolean().default(true),
}).strict();
export const CoreStructureSchema = z.object({
  domains: z.array(CoreDomainChoiceSchema).max(50).default([]),
  areas: z.array(CoreAreaChoiceSchema).max(50).default([]),
}).strict();
export const CoreOnboardingDraftSchema = OnboardingDraftSchema.pipe(z.object({
  welcome: z.object({ context: z.string().max(4000).optional(), timezone: z.string().max(100).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(), settings_confirmed: z.boolean().optional() }).strict().optional(),
  ai: z.object({ mode: z.enum(['manual', 'configure']).optional() }).strict().optional(),
  integrations: z.object({ deferred: z.boolean().optional() }).strict().optional(),
  structure: CoreStructureSchema.optional(),
  vehicle: z.object({ deferred: z.boolean().optional(), domain_id: z.string().uuid().nullable().optional() }).strict().optional(),
  practice: z.object({ choice: z.enum(['manual_task', 'manual_note', 'manual_project', 'skipped']).optional() }).strict().optional(),
  summary: z.object({ acknowledged: z.boolean().optional() }).strict().optional(),
}).strict());
export type CoreOnboardingDraft = z.infer<typeof CoreOnboardingDraftSchema>;
export type CoreStructure = z.infer<typeof CoreStructureSchema>;

export interface CoreReadinessCheck {
  id: string;
  title: string;
  required: boolean;
  status: 'passed' | 'configured' | 'unavailable' | 'degraded';
  detail: string;
}
export interface CoreSetupContext {
  domains: { id: string; name: string; is_system: boolean }[];
  areas: { id: string; name: string; domain_id: string | null }[];
  children: { id: string; status: string; subject_id: string | null }[];
  receipts: { id: string; action_id: string; receipt: OnboardingReceipt }[];
  readiness: CoreReadinessCheck[];
  capabilities: OnboardingCapability[];
}
