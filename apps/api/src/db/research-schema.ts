import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ResearchJobRequest, ResearchOperation, ResearchResult } from '@jevi-ops/shared';
import { assets } from './schema.js';
import { source_documents } from './source-schema.js';
const time = () => timestamp({ withTimezone: true, mode: 'string' });
export const research_workers = pgTable('research_workers', {
  id: uuid().primaryKey().defaultRandom(), name: text().notNull(), adapter: text().notNull(), adapter_version: text().notNull(),
  capabilities: jsonb().$type<string[]>().notNull().default([]), allowed_task_types: jsonb().$type<string[]>().notNull().default([]),
  enabled: boolean().notNull().default(true), configuration_verified: boolean().notNull().default(false), last_seen_at: time(), last_health_ok: boolean(), health_detail: text(),
  last_successful_at: time(), created_at: time().notNull().defaultNow(), updated_at: time().notNull().defaultNow(),
});
export const research_jobs = pgTable('research_jobs', {
  id: uuid().primaryKey().defaultRandom(), schema_version: integer().notNull().default(1),
  asset_id: uuid().notNull().references(() => assets.id, { onDelete: 'cascade' }),
  requested_worker_id: uuid().references(() => research_workers.id), requester: text().notNull(), origin: text().notNull().default('owner'),
  operation_key: text().notNull(), fingerprint: text().notNull(), request: jsonb().$type<ResearchJobRequest>().notNull(),
  context: jsonb().$type<Record<string, unknown>>().notNull(), context_snapshot: text().notNull(), original_metadata: jsonb().$type<Record<string, unknown>>().notNull(), original_doc_version: integer().notNull(),
  status: text().$type<'requested' | 'leased' | 'running' | 'succeeded' | 'failed' | 'cancelled'>().notNull().default('requested'),
  attempts: integer().notNull().default(0), next_attempt_at: time().notNull().defaultNow(),
  worker_id: uuid().references(() => research_workers.id), run_id: uuid(), lease_token_hash: text(), lease_expires_at: time(), run_deadline: time(),
  failure_reason: text(), last_checked_at: time(), created_at: time().notNull().defaultNow(), updated_at: time().notNull().defaultNow(),
}, (t) => [
  unique('research_jobs_request_key').on(t.requester, t.operation_key),
  index('research_jobs_pending').on(t.status, t.next_attempt_at),
  check('research_jobs_status_check', sql`${t.status} in ('requested','leased','running','succeeded','failed','cancelled')`),
]);
export const research_results = pgTable('research_results', {
  id: uuid().primaryKey().defaultRandom(), job_id: uuid().notNull().unique().references(() => research_jobs.id, { onDelete: 'cascade' }),
  worker_id: uuid().notNull().references(() => research_workers.id), run_id: uuid().notNull(), operation_key: text().notNull(), fingerprint: text().notNull(),
  result: jsonb().$type<Omit<ResearchResult, 'lease_token'>>().notNull(), source_map: jsonb().$type<Record<string, string>>().notNull(),
  receipt: jsonb().$type<Record<string, unknown>>().notNull(), created_at: time().notNull().defaultNow(),
});
export const research_result_sources = pgTable('research_result_sources', {
  id: uuid().primaryKey().defaultRandom(), result_id: uuid().notNull().references(() => research_results.id, { onDelete: 'cascade' }),
  source_id: uuid().notNull().references(() => source_documents.id),
}, (t) => [unique('research_result_sources_identity').on(t.result_id, t.source_id)]);
export const research_proposals = pgTable('research_proposals', {
  id: uuid().primaryKey().defaultRandom(), job_id: uuid().notNull().references(() => research_jobs.id, { onDelete: 'cascade' }),
  result_id: uuid().notNull().unique().references(() => research_results.id, { onDelete: 'cascade' }), asset_id: uuid().notNull().references(() => assets.id, { onDelete: 'cascade' }),
  operations: jsonb().$type<ResearchOperation[]>().notNull(),
  status: text().$type<'pending_review' | 'applied' | 'rejected' | 'superseded' | 'conflicted'>().notNull().default('pending_review'),
  revision: integer().notNull().default(1), preview: jsonb().$type<Record<string, unknown>>(), fingerprint: text(),
  operation_key: text(), receipt: jsonb().$type<Record<string, unknown>>(), actor: text(), reason: text(),
  created_at: time().notNull().defaultNow(), updated_at: time().notNull().defaultNow(),
}, (t) => [check('research_proposals_status_check', sql`${t.status} in ('pending_review','applied','rejected','superseded','conflicted')`)]);
export const research_audit = pgTable('research_audit', {
  id: uuid().primaryKey().defaultRandom(), job_id: uuid().notNull().references(() => research_jobs.id, { onDelete: 'cascade' }),
  event: text().notNull(), actor: text().notNull(), detail: jsonb().$type<Record<string, unknown>>().notNull().default({}), created_at: time().notNull().defaultNow(),
});
