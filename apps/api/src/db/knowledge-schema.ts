import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { KnowledgeChange, KnowledgeEffectiveTime, KnowledgePreconditions, KnowledgePreviewChange, KnowledgeReceipt, KnowledgeTransitionStatus } from '@jevi-ops/shared';
import { assets, maintenance_items } from './schema.js';
import { source_documents } from './source-schema.js';

const time = () => timestamp({ withTimezone: true, mode: 'string' });
export const responsibility_rules = pgTable('responsibility_rules', {
  id: uuid().primaryKey().defaultRandom(),
  current_version: integer().notNull().default(1),
  creation_key: text(), creation_actor: text(), creation_fingerprint: text(),
  created_at: time().notNull().defaultNow(),
}, (t) => [unique('responsibility_rules_creation_identity').on(t.creation_actor, t.creation_key), check('responsibility_rules_version_check', sql`${t.current_version} > 0`)]);

export const responsibility_rule_versions = pgTable('responsibility_rule_versions', {
  id: uuid().primaryKey().defaultRandom(),
  rule_id: uuid().notNull().references(() => responsibility_rules.id),
  version: integer().notNull(),
  title: text().notNull(),
  kind: text().$type<'user_reminder' | 'service_recommendation' | 'regulatory'>().notNull(),
  scope: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  status: text().$type<'proposed' | 'accepted' | 'withdrawn'>().notNull(),
  source_note: text(),
  published_at: time(), retrieved_at: time(),
  effective_from: jsonb().$type<KnowledgeEffectiveTime>(),
  effective_until: jsonb().$type<KnowledgeEffectiveTime>(),
  effective_from_at: time(), effective_until_at: time(),
  reason: text().notNull(), actor: text().notNull(),
  created_at: time().notNull().defaultNow(),
}, (t) => [
  unique('responsibility_rule_versions_identity').on(t.rule_id, t.version),
  check('responsibility_rule_versions_kind_check', sql`${t.kind} in ('user_reminder', 'service_recommendation', 'regulatory')`),
  check('responsibility_rule_versions_status_check', sql`${t.status} in ('proposed', 'accepted', 'withdrawn')`),
  check('responsibility_rule_versions_version_check', sql`${t.version} > 0`),
]);
export const responsibility_rule_sources = pgTable('responsibility_rule_sources', {
  id: uuid().primaryKey().defaultRandom(),
  rule_version_id: uuid().notNull().references(() => responsibility_rule_versions.id),
  source_id: uuid().notNull().references(() => source_documents.id),
}, (t) => [unique('responsibility_rule_sources_identity').on(t.rule_version_id, t.source_id)]);

export const vehicle_assessments = pgTable('vehicle_assessments', {
  id: uuid().primaryKey().defaultRandom(),
  asset_id: uuid().notNull().references(() => assets.id, { onDelete: 'cascade' }),
  rule_id: uuid().notNull().references(() => responsibility_rules.id),
  rule_version_id: uuid().notNull().references(() => responsibility_rule_versions.id),
  revision: integer().notNull().default(1),
  applicability: text().$type<'unknown' | 'applicable' | 'not_applicable'>().notNull(),
  evidence_basis: text().$type<'user_reported' | 'document_supported' | 'official_source_supported'>().notNull(),
  review_state: text().$type<'unreviewed' | 'accepted' | 'needs_review'>().notNull(),
  relevant_facts: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  source_ids: jsonb().$type<string[]>().notNull().default([]),
  rationale: text().notNull(), actor: text().notNull(),
  assessed_at: time().notNull(), last_checked_at: time(), review_due_at: time(),
  item_id: uuid().references(() => maintenance_items.id, { onDelete: 'set null' }),
  invalidation_reason: text(),
  created_at: time().notNull().defaultNow(), updated_at: time().notNull().defaultNow(),
}, (t) => [
  unique('vehicle_assessments_asset_rule_identity').on(t.asset_id, t.rule_id),
  check('vehicle_assessments_applicability_check', sql`${t.applicability} in ('unknown', 'applicable', 'not_applicable')`),
  check('vehicle_assessments_evidence_basis_check', sql`${t.evidence_basis} in ('user_reported', 'document_supported', 'official_source_supported')`),
  check('vehicle_assessments_review_state_check', sql`${t.review_state} in ('unreviewed', 'accepted', 'needs_review')`),
  check('vehicle_assessments_revision_check', sql`${t.revision} > 0`),
]);
export const vehicle_assessment_history = pgTable('vehicle_assessment_history', {
  id: uuid().primaryKey().defaultRandom(),
  assessment_id: uuid().notNull().references(() => vehicle_assessments.id, { onDelete: 'cascade' }),
  revision: integer().notNull(), snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
  actor: text().notNull(), reason: text().notNull(), created_at: time().notNull().defaultNow(),
}, (t) => [unique('vehicle_assessment_history_identity').on(t.assessment_id, t.revision)]);

export const knowledge_change_previews = pgTable('knowledge_change_previews', {
  id: uuid().primaryKey().defaultRandom(),
  asset_id: uuid().notNull().references(() => assets.id, { onDelete: 'cascade' }),
  operation: jsonb().$type<KnowledgeChange>().notNull(),
  fingerprint: text().notNull(), preconditions: jsonb().$type<KnowledgePreconditions>().notNull(),
  changes: jsonb().$type<KnowledgePreviewChange[]>().notNull(),
  actor: text().notNull(), operation_key: text(), receipt: jsonb().$type<KnowledgeReceipt>(),
  created_at: time().notNull().defaultNow(),
}, (t) => [unique('knowledge_change_preview_operation_key').on(t.actor, t.operation_key)]);

export const knowledge_transitions = pgTable('knowledge_transitions', {
  id: uuid().primaryKey().defaultRandom(),
  asset_id: uuid().notNull().references(() => assets.id, { onDelete: 'cascade' }),
  preview_id: uuid().notNull().unique().references(() => knowledge_change_previews.id),
  operation: jsonb().$type<KnowledgeChange>().notNull(),
  preconditions: jsonb().$type<KnowledgePreconditions>().notNull(),
  effective: jsonb().$type<KnowledgeEffectiveTime>().notNull(), effective_at: time(),
  status: text().$type<KnowledgeTransitionStatus>().notNull().default('pending'),
  revision: integer().notNull().default(1),
  actor: text().notNull(), approved_at: time().notNull().defaultNow(),
  reason: text(), receipt: jsonb().$type<KnowledgeReceipt>(), applied_at: time(),
  updated_at: time().notNull().defaultNow(),
}, (t) => [
  index('knowledge_transitions_due').on(t.status, t.effective_at),
  check('knowledge_transitions_status_check', sql`${t.status} in ('pending', 'applied', 'needs_review', 'cancelled', 'superseded')`),
  check('knowledge_transitions_revision_check', sql`${t.revision} > 0`),
  check('knowledge_transitions_receipt_check', sql`(${t.status} = 'applied') = (${t.receipt} is not null and ${t.applied_at} is not null)`),
]);
export const knowledge_transition_history = pgTable('knowledge_transition_history', {
  id: uuid().primaryKey().defaultRandom(),
  transition_id: uuid().notNull().references(() => knowledge_transitions.id, { onDelete: 'cascade' }),
  revision: integer().notNull(), snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
  actor: text().notNull(), reason: text().notNull(), created_at: time().notNull().defaultNow(),
}, (t) => [unique('knowledge_transition_history_identity').on(t.transition_id, t.revision)]);
