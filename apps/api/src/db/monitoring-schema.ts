import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { MonitoringPolicyConfig, MonitoringAssetReview } from '@jevi-ops/shared';
import { research_workers, research_jobs } from './research-schema.js';
import { source_documents } from './source-schema.js';
const time = () => timestamp({ withTimezone: true, mode: 'string' });
export const monitoring_policies = pgTable('monitoring_policies', {
  id: uuid().primaryKey().defaultRandom(), worker_id: uuid().notNull().references(() => research_workers.id), config: jsonb().$type<MonitoringPolicyConfig>().notNull(),
  creation_key: text(), creation_actor: text(), creation_fingerprint: text(),
  revision: integer().notNull().default(1), next_due_at: time().notNull().defaultNow(), retry_after_at: time(),
  last_swept_at: time(), last_attempt_at: time(), last_successful_at: time(), last_outcome: text(), last_trigger_fingerprint: text(), failure_count: integer().notNull().default(0),
  actor: text().notNull(), created_at: time().notNull().defaultNow(), updated_at: time().notNull().defaultNow(),
}, (t) => [unique('monitoring_policies_creation_identity').on(t.creation_actor, t.creation_key)]);
export const monitoring_signals = pgTable('monitoring_signals', {
  id: uuid().primaryKey().defaultRandom(), policy_id: uuid().notNull().references(() => monitoring_policies.id, { onDelete: 'cascade' }),
  operation_key: text().notNull(), fingerprint: text().notNull(), kind: text().notNull(), reason: text().notNull(), source_id: uuid().references(() => source_documents.id), actor: text().notNull(),
  processed_at: time(), created_at: time().notNull().defaultNow(),
}, (t) => [unique('monitoring_signals_operation_identity').on(t.policy_id, t.operation_key)]);
export const monitoring_review_runs = pgTable('monitoring_review_runs', {
  id: uuid().primaryKey().defaultRandom(), policy_id: uuid().notNull().references(() => monitoring_policies.id, { onDelete: 'cascade' }),
  policy_revision: integer().notNull(), trigger_key: text().notNull(), reasons: jsonb().$type<string[]>().notNull(),
  shared_job_id: uuid().references(() => research_jobs.id), asset_reviews: jsonb().$type<MonitoringAssetReview[]>().notNull().default([]),
  status: text().$type<'researching' | 'evaluating' | 'complete' | 'failed' | 'cancelled'>().notNull().default('researching'),
  created_at: time().notNull().defaultNow(), completed_at: time(),
}, (t) => [unique('monitoring_review_runs_trigger_identity').on(t.policy_id, t.trigger_key), check('monitoring_review_runs_status_check', sql`${t.status} in ('researching','evaluating','complete','failed','cancelled')`)]);
export const monitoring_notifications = pgTable('monitoring_notifications', {
  id: uuid().primaryKey().defaultRandom(), policy_id: uuid().notNull().references(() => monitoring_policies.id, { onDelete: 'cascade' }),
  dedup_key: text().notNull(), kind: text().notNull(), title: text().notNull(), detail: text().notNull(), created_at: time().notNull().defaultNow(), read_at: time(),
}, (t) => [unique('monitoring_notifications_dedup_identity').on(t.policy_id, t.dedup_key)]);
