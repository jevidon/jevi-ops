import { z } from 'zod';
import { ResearchJobInputSchema } from './research.js';
export const MonitoringPolicyInputSchema = z.object({
  creation_key: z.string().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200), asset_ids: z.array(z.string().uuid()).min(1).max(30), worker_id: z.string().uuid(),
  enabled: z.boolean().default(false), question: z.string().trim().min(1).max(10_000),
  allowed_domains: ResearchJobInputSchema.shape.allowed_domains,
  cadence_hours: z.number().int().min(1).max(8760).default(720),
  budget: ResearchJobInputSchema.shape.budget,
  scope: z.object({ country: z.string().regex(/^[A-Z]{2}$/).optional(), rule_ids: z.array(z.string().uuid()).max(100).default([]), categories: z.array(z.enum(['regulatory', 'service_recommendation', 'user_reminder'])).min(1).max(3).default(['regulatory']) }).default({}),
  notifications: z.enum(['meaningful_changes', 'off']).default('meaningful_changes'),
}).strict();
export const UpdateMonitoringPolicySchema = MonitoringPolicyInputSchema.omit({ creation_key: true }).partial().extend({ expected_revision: z.number().int().positive() });
export const MonitoringSignalSchema = z.object({
  operation_key: z.string().min(1).max(200), kind: z.enum(['user_report', 'source_change', 'manual_review']),
  reason: z.string().trim().min(1).max(10_000), source_id: z.string().uuid().optional(),
}).strict();
export type MonitoringPolicyInput = z.input<typeof MonitoringPolicyInputSchema>;
export type MonitoringPolicyConfig = Omit<z.infer<typeof MonitoringPolicyInputSchema>, 'creation_key'>;
export interface MonitoringAssetReview { asset_id: string; job_id?: string; status: 'waiting' | 'requested' | 'succeeded' | 'failed' | 'skipped'; outcome?: string; proposal_id?: string | null }
