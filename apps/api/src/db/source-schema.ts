import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, unique, check } from 'drizzle-orm/pg-core';
import { assets } from './schema.js';
import { onboarding_sessions } from './onboarding-schema.js';
import type { SourceCandidate } from '@jevi-ops/shared';

export const source_documents = pgTable('source_documents', {
  id: uuid().primaryKey().defaultRandom(),
  kind: text().$type<'file' | 'text' | 'link'>().notNull(),
  content_hash: text().notNull().unique(),
  media_type: text().notNull(),
  size_bytes: integer().notNull(),
  storage_key: text(),
  text_content: text(),
  source_url: text(),
  created_at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [
  check('source_documents_kind_check', sql`${t.kind} in ('file', 'text', 'link')`),
  check('source_documents_size_bytes_check', sql`${t.size_bytes} >= 0`),
  check('source_documents_check', sql`(${t.kind} = 'file' and ${t.storage_key} is not null and ${t.text_content} is null) or (${t.kind} = 'text' and ${t.text_content} is not null and ${t.storage_key} is null) or (${t.kind} = 'link' and ${t.source_url} is not null and ${t.storage_key} is null)`),
]);
export const source_links = pgTable('source_links', {
  id: uuid().primaryKey().defaultRandom(),
  source_id: uuid().notNull().references(() => source_documents.id),
  asset_id: uuid().references(() => assets.id, { onDelete: 'cascade' }),
  session_id: uuid().references(() => onboarding_sessions.id, { onDelete: 'cascade' }),
  label: text().notNull(),
  actor: text().notNull(),
  created_at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [
  check('source_links_check', sql`(${t.asset_id} is not null)::int + (${t.session_id} is not null)::int = 1`),
  uniqueIndex('idx_source_links_asset').on(t.source_id, t.asset_id).where(sql`${t.asset_id} is not null`),
  uniqueIndex('idx_source_links_session').on(t.source_id, t.session_id).where(sql`${t.session_id} is not null`),
]);
export const source_candidates = pgTable('source_candidates', {
  id: uuid().primaryKey().defaultRandom(),
  source_link_id: uuid().notNull().references(() => source_links.id),
  operation_key: text().notNull(),
  creation_fingerprint: text().notNull(),
  candidate: jsonb().$type<SourceCandidate>().notNull(),
  revision: integer().notNull().default(1),
  status: text().$type<'pending' | 'accepted' | 'rejected'>().notNull().default('pending'),
  receipt: jsonb().$type<Record<string, unknown>>(),
  accepted_key: text(),
  accepted_fingerprint: text(),
  actor: text().notNull(),
  created_at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [
  unique('source_candidates_source_link_id_operation_key_key').on(t.source_link_id, t.operation_key),
  check('source_candidates_revision_check', sql`${t.revision} > 0`),
  check('source_candidates_status_check', sql`${t.status} in ('pending', 'accepted', 'rejected')`),
]);
