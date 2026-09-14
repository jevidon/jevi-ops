import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type {
  CaptureAttemptStage, CaptureClient, CaptureErrorCode, CaptureIntent, CaptureKind, CaptureMediaState,
  CaptureModality, CaptureProcessingState, CaptureStorageState, OperationDisposition,
} from '@jevi-ops/shared';
import { api_tokens, captured_data } from './schema.js';

// Durable capture sidecars (migration 0053). captured_data remains the raw
// original; these tables hold the receipt, media reservations, interpretation
// attempts, and the cross-cutting operation ledger. See
// packages/shared/src/schemas/durable-capture.ts for the wire contract.

const time = () => timestamp({ withTimezone: true, mode: 'string' });

export const operation_receipts = pgTable('operation_receipts', {
  data_space_id: uuid().notNull(),
  operation_id: uuid().notNull(),
  protocol_version: integer().notNull(),
  command: text().notNull(),
  actor: text().notNull(),
  credential_id: uuid().references(() => api_tokens.id),
  digest: text().notNull(),
  disposition: text().$type<OperationDisposition>().notNull(),
  status: integer().notNull(),
  result: jsonb().$type<unknown>().notNull(),
  resource_ref: text(),
  server_epoch: integer().notNull(),
  created_at: time().notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.data_space_id, t.operation_id] }),
  check('operation_receipts_disposition_check', sql`${t.disposition} in ('applied', 'conflict', 'rejected')`),
  check('operation_receipts_status_check', sql`${t.status} between 200 and 599`),
]);

export const capture_receipts = pgTable('capture_receipts', {
  capture_id: uuid().primaryKey().references(() => captured_data.id, { onDelete: 'cascade' }),
  data_space_id: uuid().notNull(),
  operation_id: uuid().notNull(),
  actor: text().notNull(),
  credential_id: uuid().references(() => api_tokens.id),
  client: jsonb().$type<CaptureClient>().notNull(),
  source_item_id: text(),
  kind: text().$type<CaptureKind>().notNull(),
  intent: text().$type<CaptureIntent>().notNull().default('capture_only'),
  modality: text().$type<CaptureModality>(),
  captured_at: time().notNull(),
  time_zone: text(),
  storage_state: text().$type<CaptureStorageState>().notNull().default('complete'),
  processing_state: text().$type<CaptureProcessingState>().notNull().default('queued'),
  input_revision: integer().notNull().default(1),
  current_attempt_no: integer().notNull().default(0),
  error_code: text().$type<CaptureErrorCode>(),
  outcome: jsonb().$type<unknown>(),
  finalized_at: time(),
  created_at: time().notNull().defaultNow(),
  updated_at: time().notNull().defaultNow(),
}, (t) => [
  unique('capture_receipts_operation_identity').on(t.data_space_id, t.operation_id),
  index('capture_receipts_pending').on(t.processing_state, t.created_at),
  check('capture_receipts_kind_check', sql`${t.kind} in ('text', 'audio', 'image')`),
  check('capture_receipts_intent_check', sql`${t.intent} in ('capture_only', 'conversation_turn')`),
  check('capture_receipts_modality_check', sql`${t.modality} is null or ${t.modality} in ('typed', 'spoken', 'photo')`),
  check('capture_receipts_storage_check', sql`${t.storage_state} in ('complete', 'awaiting_media')`),
  check('capture_receipts_processing_check', sql`${t.processing_state} in ('awaiting_media', 'queued', 'preprocessing', 'ready_for_hermes', 'interpreting', 'needs_review', 'committed', 'retry_wait', 'blocked', 'cancelled')`),
]);

export const capture_media = pgTable('capture_media', {
  attachment_id: uuid().primaryKey(),
  capture_id: uuid().notNull().references(() => captured_data.id, { onDelete: 'cascade' }),
  media_type: text().notNull(),
  size_bytes: integer().notNull(),
  sha256: text().notNull(),
  storage_key: text(),
  state: text().$type<CaptureMediaState>().notNull().default('reserved'),
  verified_at: time(),
  created_at: time().notNull().defaultNow(),
}, (t) => [
  index('capture_media_by_capture').on(t.capture_id),
  check('capture_media_state_check', sql`${t.state} in ('reserved', 'verified')`),
  check('capture_media_size_check', sql`${t.size_bytes} > 0`),
]);

export const capture_attempts = pgTable('capture_attempts', {
  capture_id: uuid().notNull().references(() => captured_data.id, { onDelete: 'cascade' }),
  attempt_no: integer().notNull(),
  attempt_token_hash: text().notNull(),
  operation_id: uuid().notNull(),
  stage: text().$type<CaptureAttemptStage>().notNull().default('pending'),
  stage_changed_at: time().notNull().defaultNow(),
  heartbeat_at: time().notNull().defaultNow(),
  plan: jsonb().$type<unknown>(),
  effects: jsonb().$type<unknown>(),
  error_code: text().$type<CaptureErrorCode>(),
  finished_at: time(),
  created_at: time().notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.capture_id, t.attempt_no] }),
  check('capture_attempts_stage_check', sql`${t.stage} in ('pending', 'transcribing', 'parsing', 'executing', 'recording', 'finished')`),
]);
