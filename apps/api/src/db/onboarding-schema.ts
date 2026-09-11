import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { OnboardingDraft, OnboardingPreview, OnboardingReceipt, OnboardingStatus, OnboardingStepState } from '@jevi-ops/shared/schemas';
import { assets, auth_user } from './schema.js';

export const onboarding_sessions = pgTable('onboarding_sessions', {
  id: uuid().primaryKey().defaultRandom(),
  owner_id: uuid().notNull().references(() => auth_user.id),
  creation_key: text().notNull(),
  creation_fingerprint: text().notNull(),
  module_id: text().$type<'core' | 'vehicle'>().notNull(),
  module_version: integer().notNull(),
  subject_id: uuid().references(() => assets.id),
  parent_session_id: uuid().references((): AnyPgColumn => onboarding_sessions.id),
  status: text().$type<OnboardingStatus>().notNull().default('in_progress'),
  current_step_id: text().notNull(),
  step_states: jsonb().$type<Record<string, OnboardingStepState>>().notNull().default({}),
  draft: jsonb().$type<OnboardingDraft>().notNull().default({}),
  revision: integer().notNull().default(0),
  preview: jsonb().$type<OnboardingPreview>(),
  commit_operation_key: text(),
  commit_receipt: jsonb().$type<OnboardingReceipt>(),
  created_at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  completed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (t) => [
  uniqueIndex('onboarding_sessions_creation_key').on(t.owner_id, t.creation_key),
  uniqueIndex('onboarding_sessions_active_subject').on(t.module_id, t.subject_id).where(sql`subject_id is not null and status in ('in_progress', 'deferred')`),
  uniqueIndex('onboarding_sessions_active_core').on(t.owner_id, t.module_id).where(sql`module_id = 'core' and status in ('in_progress', 'deferred')`),
  uniqueIndex('onboarding_sessions_commit_key').on(t.owner_id, t.commit_operation_key).where(sql`commit_operation_key is not null`),
  index('onboarding_sessions_owner_updated').on(t.owner_id, t.updated_at),
  check('onboarding_sessions_module', sql`module_id in ('core', 'vehicle')`),
  check('onboarding_sessions_status', sql`status in ('in_progress', 'deferred', 'completed', 'abandoned')`),
  check('onboarding_sessions_revision', sql`revision >= 0 and module_version > 0`),
  check('onboarding_sessions_completed_receipt', sql`(status = 'completed') = (commit_receipt is not null and commit_operation_key is not null and completed_at is not null)`),
]);

export const installation_setup = pgTable('installation_setup', {
  id: boolean().primaryKey().default(true),
  state: text().$type<'eligible' | 'opt_in' | 'in_progress' | 'deferred' | 'completed'>().notNull().default('eligible'),
  core_session_id: uuid().references(() => onboarding_sessions.id),
  updated_at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [check('installation_setup_singleton', sql`id`), check('installation_setup_state', sql`state in ('eligible', 'opt_in', 'in_progress', 'deferred', 'completed')`)]);

export const onboarding_operation_receipts = pgTable('onboarding_operation_receipts', {
  id: uuid().primaryKey().defaultRandom(),
  session_id: uuid().notNull().references(() => onboarding_sessions.id),
  action_id: text().notNull(),
  operation_key: text().notNull(),
  receipt: jsonb().$type<OnboardingReceipt>().notNull(),
  created_at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [uniqueIndex('onboarding_operations_key').on(t.session_id, t.operation_key)]);
