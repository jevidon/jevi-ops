import { pgTable, index, foreignKey, check, uuid, text, numeric, date, timestamp, unique, jsonb, boolean, integer, real, time, smallint, bigint } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// ─── Typed jsonb payload shapes ────────────────────────────────────────────
// Stored as jsonb in Postgres; the app reads/writes them with these shapes.
// StoredAttachment is the persisted attachment record (originally written by
// the Bunny uploader, now by lib/storage.ts) — keep in sync with the web's
// Attachment type in apps/web/src/lib/api.ts.

export interface StoredAttachment {
  url: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  alt: string | null;
  uploaded_at: string;
  gps?: { lat: number; lon: number } | null;
  location?: string | null;
}

/** One rule in stewardship_domains.failure_patterns (see lib/observations.ts). */
export interface FailurePattern {
  rule: string;
  [key: string]: unknown;
}

/**
 * stewardship_domains.illustration (migration 0032) — server-generated
 * engraved spot art for the Domains board. `svg` is sanitized inner-SVG
 * markup (240×100 canvas); written only by lib/illustration.ts. Keep in
 * sync with DomainIllustrationSchema in @jevi-ops/shared.
 */
export interface DomainIllustration {
  svg: string;
  style: 'engraved';
  source: 'llm' | 'procedural';
  generated_at: string;
}

/** One item in checklist_templates.items / checklist_instances.items. */
export interface ChecklistItemJson {
  title: string;
  done?: boolean;
  [key: string]: unknown;
}

/** Free-form entry in the health_history singleton arrays. */
export type HealthHistoryItem = Record<string, unknown> | string;




export const projects = pgTable("projects", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	domain_id: uuid(),
	status: text().default('active').notNull(),
	type: text(),
	client_id: uuid(),
	quoted_hours: numeric({ mode: 'number', precision: 8, scale:  2 }),
	hours_logged: numeric({ mode: 'number', precision: 8, scale:  2 }).default(0).notNull(),
	start_date: date(),
	target_date: date(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	color: text(),
	engagement_type: text().default('project').notNull(),
	kind: text().default('project').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_projects_domain").using("btree", table.domain_id.asc().nullsLast().op("uuid_ops")),
	index("idx_projects_kind_status").using("btree", table.kind.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	index("idx_projects_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.domain_id],
			foreignColumns: [stewardship_domains.id],
			name: "projects_domain_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.client_id],
			foreignColumns: [people.id],
			name: "projects_client_id_fkey"
		}).onDelete("set null"),
	check("projects_status_check", sql`status = ANY (ARRAY['active'::text, 'paused'::text, 'done'::text, 'archived'::text])`),
	check("projects_type_check", sql`type = ANY (ARRAY['client'::text, 'internal'::text, 'content'::text])`),
	check("projects_engagement_type_check", sql`engagement_type = ANY (ARRAY['project'::text, 'retainer'::text])`),
	check("projects_kind_check", sql`kind = ANY (ARRAY['project'::text, 'area'::text])`),
]);

export const stewardship_domains = pgTable("stewardship_domains", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	fruit_definition: text(),
	failure_patterns: jsonb().$type<FailurePattern[]>().default([]).notNull(),
	expected_cadence: text(),
	active: boolean().default(true).notNull(),
	is_system: boolean().default(false).notNull(),
	last_shipped_at: timestamp({ withTimezone: true, mode: 'string' }),
	illustration: jsonb().$type<DomainIllustration>(),
	// Candidate awaiting Keep/Discard on the settings page (migration 0033).
	illustration_draft: jsonb().$type<DomainIllustration>(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("stewardship_domains_name_key").on(table.name),
]);

export const people = pgTable("people", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	relationship_type: text(),
	email: text(),
	phone: text(),
	company: text(),
	notes: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_people_name_lower").using("btree", sql`lower(name)`),
	check("people_relationship_type_check", sql`relationship_type = ANY (ARRAY['client'::text, 'family'::text, 'church'::text, 'friend'::text, 'team'::text, 'vendor'::text, 'other'::text])`),
]);

export const person_facts = pgTable("person_facts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	person_id: uuid().notNull(),
	fact_type: text().notNull(),
	fact_value: text().notNull(),
	source_ref: text(),
	date_relevant: date(),
	recurring: boolean().default(false).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_person_facts_date").using("btree", table.date_relevant.asc().nullsLast().op("date_ops")).where(sql`(date_relevant IS NOT NULL)`),
	index("idx_person_facts_person").using("btree", table.person_id.asc().nullsLast().op("uuid_ops")),
	index("idx_person_facts_type").using("btree", table.fact_type.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.person_id],
			foreignColumns: [people.id],
			name: "person_facts_person_id_fkey"
		}).onDelete("cascade"),
	check("person_facts_fact_type_check", sql`fact_type = ANY (ARRAY['anniversary'::text, 'birthday'::text, 'kid_name'::text, 'shared'::text, 'follow_up'::text, 'other'::text])`),
]);

export const person_interactions = pgTable("person_interactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	person_id: uuid().notNull(),
	interaction_type: text().notNull(),
	notes: text(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_person_interactions_person_time").using("btree", table.person_id.asc().nullsLast().op("timestamptz_ops"), table.occurred_at.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.person_id],
			foreignColumns: [people.id],
			name: "person_interactions_person_id_fkey"
		}).onDelete("cascade"),
	check("person_interactions_interaction_type_check", sql`interaction_type = ANY (ARRAY['email'::text, 'call'::text, 'in_person'::text, 'text'::text, 'meeting'::text, 'other'::text])`),
]);

export const milestones = pgTable("milestones", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	project_id: uuid().notNull(),
	title: text().notNull(),
	status: text().default('open').notNull(),
	weight: integer().default(1).notNull(),
	position: integer().default(0).notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_milestones_project_position").using("btree", table.project_id.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "milestones_project_id_fkey"
		}).onDelete("cascade"),
	check("milestones_status_check", sql`status = ANY (ARRAY['open'::text, 'done'::text])`),
	check("milestones_weight_check", sql`weight > 0`),
]);

export const activity_log = pgTable("activity_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	project_id: uuid(),
	entry: text().notNull(),
	hours_logged: numeric({ mode: 'number', precision: 6, scale:  2 }),
	logged_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	source: text().default('manual').notNull(),
	kind: text().default('work').notNull(),
}, (table) => [
	index("idx_activity_log_project_time").using("btree", table.project_id.asc().nullsLast().op("timestamptz_ops"), table.logged_at.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "activity_log_project_id_fkey"
		}).onDelete("cascade"),
	check("activity_log_source_check", sql`source = ANY (ARRAY['manual'::text, 'voice'::text, 'email'::text, 'observation'::text, 'import'::text])`),
	check("activity_log_kind_check", sql`kind = ANY (ARRAY['work'::text, 'update'::text])`),
]);

export const project_checklist_items = pgTable("project_checklist_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	project_id: uuid().notNull(),
	position: integer().default(0).notNull(),
	title: text().notNull(),
	done: boolean().default(false).notNull(),
	done_at: timestamp({ withTimezone: true, mode: 'string' }),
	recurrence_rule: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_project_checklist_items_project_position").using("btree", table.project_id.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "project_checklist_items_project_id_fkey"
		}).onDelete("cascade"),
	check("project_checklist_items_recurrence_rule_check", sql`recurrence_rule = ANY (ARRAY['daily'::text, 'weekdays'::text, 'weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text, 'semiannually'::text, 'yearly'::text])`),
]);

export const content_items = pgTable("content_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	domain_id: uuid(),
	type: text().notNull(),
	status: text().default('idea').notNull(),
	outline_md: text(),
	video_url: text(),
	article_url: text(),
	published_at: timestamp({ withTimezone: true, mode: 'string' }),
	parent_id: uuid(),
	derivative_type: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_content_items_domain_status").using("btree", table.domain_id.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	index("idx_content_items_parent").using("btree", table.parent_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.domain_id],
			foreignColumns: [stewardship_domains.id],
			name: "content_items_domain_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.parent_id],
			foreignColumns: [table.id],
			name: "content_items_parent_id_fkey"
		}).onDelete("set null"),
	check("content_items_type_check", sql`type = ANY (ARRAY['video'::text, 'article'::text, 'short_clip'::text, 'podcast_episode'::text, 'newsletter'::text])`),
	check("content_items_status_check", sql`status = ANY (ARRAY['idea'::text, 'outline'::text, 'filming'::text, 'editing'::text, 'published'::text, 'derivatives_pending'::text, 'done'::text])`),
]);

export const content_checklist_items = pgTable("content_checklist_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	content_item_id: uuid().notNull(),
	position: integer().default(0).notNull(),
	title: text().notNull(),
	done: boolean().default(false).notNull(),
	done_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_content_checklist_items_content_position").using("btree", table.content_item_id.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.content_item_id],
			foreignColumns: [content_items.id],
			name: "content_checklist_items_content_item_id_fkey"
		}).onDelete("cascade"),
]);

export const content_templates = pgTable("content_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	channel: text().notNull(),
	trigger_status: text().notNull(),
	derivative_type: text().notNull(),
	title_template: text().notNull(),
	default_due_offset_days: integer().default(7).notNull(),
	active: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	notes: text(),
	status: text().default('open').notNull(),
	due_date: date(),
	due_time: time(),
	priority: integer().default(4).notNull(),
	project_id: uuid(),
	parent_task_id: uuid(),
	content_item_id: uuid(),
	milestone_id: uuid(),
	domain_id: uuid().notNull(),
	recurrence_rule: text(),
	reminder_offsets: jsonb().$type<number[]>().default([]).notNull(),
	reminders_sent: jsonb().$type<Record<string, string>>().default({}).notNull(),
	source: text().default('manual').notNull(),
	top3_for_date: date(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_tasks_content_item").using("btree", table.content_item_id.asc().nullsLast().op("uuid_ops")).where(sql`(content_item_id IS NOT NULL)`),
	index("idx_tasks_domain").using("btree", table.domain_id.asc().nullsLast().op("uuid_ops")),
	index("idx_tasks_parent").using("btree", table.parent_task_id.asc().nullsLast().op("uuid_ops")),
	index("idx_tasks_project").using("btree", table.project_id.asc().nullsLast().op("uuid_ops")),
	index("idx_tasks_status_due").using("btree", table.status.asc().nullsLast().op("text_ops"), table.due_date.asc().nullsLast().op("text_ops")),
	index("idx_tasks_top3").using("btree", table.top3_for_date.asc().nullsLast().op("date_ops")).where(sql`(top3_for_date IS NOT NULL)`),
	index("tasks_milestone_id_idx").using("btree", table.milestone_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "tasks_project_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.milestone_id],
			foreignColumns: [milestones.id],
			name: "tasks_milestone_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.parent_task_id],
			foreignColumns: [table.id],
			name: "tasks_parent_task_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.content_item_id],
			foreignColumns: [content_items.id],
			name: "tasks_content_item_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.domain_id],
			foreignColumns: [stewardship_domains.id],
			name: "tasks_domain_id_fkey"
		}),
	check("tasks_status_check", sql`status = ANY (ARRAY['open'::text, 'done'::text])`),
	check("tasks_priority_check", sql`(priority >= 1) AND (priority <= 4)`),
	check("tasks_source_check", sql`source = ANY (ARRAY['manual'::text, 'voice'::text, 'email'::text, 'observation'::text, 'import'::text])`),
]);

export const calendar_events = pgTable("calendar_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	google_event_id: text(),
	title: text().notNull(),
	description: text(),
	start_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	end_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	all_day: boolean().default(false).notNull(),
	location: text(),
	attendees: jsonb().$type<Array<string | { email?: string | null; response?: string | null }>>().default([]).notNull(),
	source: text().default('google').notNull(),
	synced_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_calendar_events_start").using("btree", table.start_at.asc().nullsLast().op("timestamptz_ops")),
	unique("calendar_events_google_event_id_key").on(table.google_event_id),
	check("calendar_events_source_check", sql`source = ANY (ARRAY['google'::text, 'created_here'::text])`),
]);

export const checklist_instances = pgTable("checklist_instances", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	template_id: uuid(),
	name: text().notNull(),
	linked_to_type: text(),
	linked_to_id: uuid(),
	items: jsonb().$type<ChecklistItemJson[]>().default([]).notNull(),
	due_date: date(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_checklist_instances_linked").using("btree", table.linked_to_type.asc().nullsLast().op("text_ops"), table.linked_to_id.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.template_id],
			foreignColumns: [checklist_templates.id],
			name: "checklist_instances_template_id_fkey"
		}).onDelete("set null"),
	check("checklist_instances_linked_to_type_check", sql`linked_to_type = ANY (ARRAY['project'::text, 'event'::text, 'standalone'::text])`),
]);

export const checklist_templates = pgTable("checklist_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	domain_id: uuid(),
	description: text(),
	items: jsonb().$type<ChecklistItemJson[]>().default([]).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.domain_id],
			foreignColumns: [stewardship_domains.id],
			name: "checklist_templates_domain_id_fkey"
		}).onDelete("set null"),
]);

export const books = pgTable("books", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	author: text(),
	isbn: text(),
	cover_image_url: text(),
	status: text().default('want_to_read').notNull(),
	format: text(),
	started_at: date(),
	finished_at: date(),
	rating: integer(),
	my_summary: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("books_status_check", sql`status = ANY (ARRAY['reading'::text, 'finished'::text, 'abandoned'::text, 'want_to_read'::text])`),
	check("books_format_check", sql`format = ANY (ARRAY['physical'::text, 'kindle'::text, 'audiobook'::text])`),
	check("books_rating_check", sql`(rating >= 1) AND (rating <= 5)`),
]);

export const quotes = pgTable("quotes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	book_id: uuid(),
	text: text().notNull(),
	page_number: integer(),
	chapter: text(),
	source_type: text(),
	source_reference: text(),
	source_url: text(),
	source_author: text(),
	tags: text().array().default([]).notNull(),
	added_via: text().default('manual').notNull(),
	last_surfaced_at: timestamp({ withTimezone: true, mode: 'string' }),
	resurface_weight: numeric({ mode: 'number' }).default(1).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_quotes_last_surfaced").using("btree", table.last_surfaced_at.asc().nullsFirst().op("timestamptz_ops")),
	index("idx_quotes_tags").using("gin", table.tags.asc().nullsLast().op("array_ops")),
	foreignKey({
			columns: [table.book_id],
			foreignColumns: [books.id],
			name: "quotes_book_id_fkey"
		}).onDelete("set null"),
	check("quotes_source_type_check", sql`source_type = ANY (ARRAY['book'::text, 'article'::text, 'podcast'::text, 'sermon'::text, 'video'::text, 'conversation'::text, 'other'::text])`),
	check("quotes_added_via_check", sql`added_via = ANY (ARRAY['voice'::text, 'readwise_import'::text, 'manual'::text, 'journal_extraction'::text])`),
	check("quotes_resurface_weight_check", sql`resurface_weight >= (0)::numeric`),
]);

export const quote_annotations = pgTable("quote_annotations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	quote_id: uuid().notNull(),
	body: text().notNull(),
	annotated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	context: text().default('unspecified'),
	tags: text().array().default([]).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_quote_annotations_quote_time").using("btree", table.quote_id.asc().nullsLast().op("timestamptz_ops"), table.annotated_at.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_quote_annotations_tags").using("gin", table.tags.asc().nullsLast().op("array_ops")),
	foreignKey({
			columns: [table.quote_id],
			foreignColumns: [quotes.id],
			name: "quote_annotations_quote_id_fkey"
		}).onDelete("cascade"),
	check("quote_annotations_context_check", sql`context = ANY (ARRAY['on_capture'::text, 'on_revisit'::text, 'on_surface'::text, 'unspecified'::text])`),
]);

export const journal_books = pgTable("journal_books", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	book_number: integer().notNull(),
	start_date: date(),
	end_date: date(),
	notes: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("journal_books_book_number_key").on(table.book_number),
]);

export const journal_entries = pgTable("journal_entries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	book_id: uuid(),
	entry_date: date().notNull(),
	image_path: text(),
	transcription_text: text(),
	source: text().default('typed').notNull(),
	tags: text().array().default([]).notNull(),
	extracted_facts: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
	attachments: jsonb().$type<StoredAttachment[]>().default([]).notNull(),
	resurface_weight: numeric({ mode: 'number' }).default(1).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_journal_entries_attachments").using("gin", table.attachments.asc().nullsLast().op("jsonb_ops")),
	index("idx_journal_entries_date").using("btree", table.entry_date.desc().nullsFirst().op("date_ops")),
	index("idx_journal_entries_tags").using("gin", table.tags.asc().nullsLast().op("array_ops")),
	foreignKey({
			columns: [table.book_id],
			foreignColumns: [journal_books.id],
			name: "journal_entries_book_id_fkey"
		}).onDelete("set null"),
	check("journal_entries_source_check", sql`source = ANY (ARRAY['handwritten_photo'::text, 'voice'::text, 'typed'::text])`),
	check("journal_entries_resurface_weight_check", sql`resurface_weight >= (0)::numeric`),
]);

export const notes = pgTable("notes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	body: text().notNull(),
	title: text(),
	source_type: text().default('own_thought').notNull(),
	source_reference: text(),
	related_quote_id: uuid(),
	needs_review: boolean().default(false).notNull(),
	tags: text().array().default([]).notNull(),
	related_project_id: uuid(),
	related_person_id: uuid(),
	attachments: jsonb().$type<StoredAttachment[]>().default([]).notNull(),
	resurface_weight: numeric({ mode: 'number' }).default(1).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notes_attachments").using("gin", table.attachments.asc().nullsLast().op("jsonb_ops")),
	index("idx_notes_needs_review").using("btree", table.needs_review.asc().nullsLast().op("bool_ops")).where(sql`(needs_review = true)`),
	index("idx_notes_related_quote").using("btree", table.related_quote_id.asc().nullsLast().op("uuid_ops")).where(sql`(related_quote_id IS NOT NULL)`),
	index("idx_notes_source_type").using("btree", table.source_type.asc().nullsLast().op("text_ops")),
	index("idx_notes_tags").using("gin", table.tags.asc().nullsLast().op("array_ops")),
	index("idx_notes_title").using("btree", table.title.asc().nullsLast().op("text_ops")).where(sql`(title IS NOT NULL)`),
	foreignKey({
			columns: [table.related_quote_id],
			foreignColumns: [quotes.id],
			name: "notes_related_quote_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.related_project_id],
			foreignColumns: [projects.id],
			name: "notes_related_project_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.related_person_id],
			foreignColumns: [people.id],
			name: "notes_related_person_id_fkey"
		}).onDelete("set null"),
	check("notes_source_type_check", sql`source_type = ANY (ARRAY['own_thought'::text, 'reading_response'::text, 'meeting_note'::text, 'brainstorm'::text, 'observation'::text, 'other'::text])`),
	check("notes_resurface_weight_check", sql`resurface_weight >= (0)::numeric`),
]);

export const inventory_categories = pgTable("inventory_categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	default_depreciation_rate: numeric({ mode: 'number', precision: 5, scale:  4 }),
	insurance_relevant: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("inventory_categories_name_key").on(table.name),
]);

export const inventory_items = pgTable("inventory_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	category: text().notNull(),
	brand: text(),
	model: text(),
	serial_number: text(),
	purchase_date: date(),
	purchase_price: numeric({ mode: 'number', precision: 12, scale:  2 }),
	purchase_source: text(),
	current_value_estimate: numeric({ mode: 'number', precision: 12, scale:  2 }),
	value_updated_at: timestamp({ withTimezone: true, mode: 'string' }),
	status: text().default('owned').notNull(),
	sold_date: date(),
	sold_price: numeric({ mode: 'number', precision: 12, scale:  2 }),
	sold_to: text(),
	photos: jsonb().$type<string[]>().default([]).notNull(),
	receipts: jsonb().$type<string[]>().default([]).notNull(),
	location: text(),
	notes: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_inventory_items_category").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("idx_inventory_items_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	check("inventory_items_status_check", sql`status = ANY (ARRAY['owned'::text, 'sold'::text, 'lost'::text, 'damaged'::text, 'loaned'::text])`),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	type: text().notNull(),
	title: text().notNull(),
	body: text(),
	source_ref: text(),
	source_url: text(),
	status: text().default('unread').notNull(),
	undo_payload: jsonb().$type<Record<string, unknown>>(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notifications_status_time").using("btree", table.status.asc().nullsLast().op("text_ops"), table.created_at.desc().nullsFirst().op("text_ops")),
	check("notifications_status_check", sql`status = ANY (ARRAY['unread'::text, 'read'::text, 'dismissed'::text])`),
]);

export const observations = pgTable("observations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	type: text().notNull(),
	severity: text().default('info').notNull(),
	title: text().notNull(),
	body: text(),
	supporting_data: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
	domain_id: uuid(),
	project_id: uuid(),
	surfaced_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	dismissed_at: timestamp({ withTimezone: true, mode: 'string' }),
	acted_on: boolean().default(false).notNull(),
}, (table) => [
	index("idx_observations_active").using("btree", table.surfaced_at.desc().nullsFirst().op("timestamptz_ops")).where(sql`(dismissed_at IS NULL)`),
	foreignKey({
			columns: [table.domain_id],
			foreignColumns: [stewardship_domains.id],
			name: "observations_domain_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "observations_project_id_fkey"
		}).onDelete("set null"),
	check("observations_severity_check", sql`severity = ANY (ARRAY['info'::text, 'notable'::text, 'concerning'::text])`),
]);

export const action_log = pgTable("action_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	action_type: text().notNull(),
	target_system: text().notNull(),
	description: text().notNull(),
	payload: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
	status: text().default('success').notNull(),
	triggered_by: text().notNull(),
	executed_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_action_log_time").using("btree", table.executed_at.desc().nullsFirst().op("timestamptz_ops")),
	check("action_log_target_system_check", sql`target_system = ANY (ARRAY['drive'::text, 'gmail'::text, 'calendar'::text, 'internal'::text, 'anthropic'::text])`),
	check("action_log_status_check", sql`status = ANY (ARRAY['success'::text, 'failed'::text, 'pending'::text, 'undone'::text])`),
]);

export const google_oauth_tokens = pgTable("google_oauth_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	access_token: text().notNull(),
	refresh_token: text(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	scope: text().notNull(),
	token_type: text().default('Bearer').notNull(),
	last_synced_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const email_rules = pgTable("email_rules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	match_criteria: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
	action_type: text().notNull(),
	action_params: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
	confidence_state: text().default('draft').notNull(),
	confirmation_count: integer().default(0).notNull(),
	active: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("email_rules_action_type_check", sql`action_type = ANY (ARRAY['move_attachments_to_drive'::text, 'create_task'::text, 'notify_only'::text, 'extract_to_inbox'::text, 'tag'::text])`),
	check("email_rules_confidence_state_check", sql`confidence_state = ANY (ARRAY['draft'::text, 'learning'::text, 'auto'::text])`),
]);

export const resurfacing_seen = pgTable("resurfacing_seen", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	item_type: text().notNull(),
	item_id: uuid().notNull(),
	surfaced_on: date().default(sql`CURRENT_DATE`).notNull(),
	user_response: text(),
}, (table) => [
	unique("resurfacing_seen_item_type_item_id_surfaced_on_key").on(table.item_type, table.item_id, table.surfaced_on),
	check("resurfacing_seen_item_type_check", sql`item_type = ANY (ARRAY['journal'::text, 'quote'::text, 'verse'::text, 'win'::text, 'note'::text, 'project_milestone'::text])`),
	check("resurfacing_seen_user_response_check", sql`user_response = ANY (ARRAY['viewed'::text, 'dismissed'::text, 'saved'::text])`),
]);

export const captured_data = pgTable("captured_data", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	source: text().notNull(),
	type: text().notNull(),
	payload: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
	tags: text().array().default([]).notNull(),
	display_hint: text().default('log').notNull(),
	processed_status: text().default('raw').notNull(),
	source_ref: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_captured_data_tags").using("gin", table.tags.asc().nullsLast().op("array_ops")),
	index("idx_captured_data_type_time").using("btree", table.type.asc().nullsLast().op("text_ops"), table.created_at.desc().nullsFirst().op("text_ops")),
	check("captured_data_source_check", sql`source = ANY (ARRAY['zapier'::text, 'cowork'::text, 'n8n'::text, 'manual'::text, 'webhook'::text, 'smart_glasses'::text, 'watch'::text, 'other'::text])`),
	check("captured_data_display_hint_check", sql`display_hint = ANY (ARRAY['card'::text, 'log'::text, 'hidden'::text])`),
	check("captured_data_processed_status_check", sql`processed_status = ANY (ARRAY['raw'::text, 'parsed'::text, 'displayed'::text, 'archived'::text])`),
]);

export const app_settings = pgTable("app_settings", {
	id: boolean().default(true).primaryKey().notNull(),
	timezone: text().default('America/Denver').notNull(),
	llm_provider: text(),
	llm_base_url: text(),
	llm_model: text(),
	llm_api_key: text(),
	stt_base_url: text(),
	stt_model: text(),
	immich_base_url: text(),
	immich_api_key: text(),
	// Module feature flags (migration 0036). rule_module_enabled exists
	// because the Editorial v2 web tree checks it; the module isn't ported.
	health_module_enabled: boolean().default(false).notNull(),
	routines_module_enabled: boolean().default(true).notNull(),
	rule_module_enabled: boolean().default(false).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("app_settings_id_check", sql`id`),
]);

// Tomorrow's Focus (migration 0037) — one optional pointer per day at a
// project or content item. target_id spans two tables → no FK; validated
// app-side (routes/focus.ts).
export const daily_focus = pgTable("daily_focus", {
	date: date().primaryKey().notNull(),
	target_type: text().notNull(),
	target_id: uuid().notNull(),
	note: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("daily_focus_target_type_check", sql`target_type = ANY (ARRAY['project'::text, 'content_item'::text])`),
]);

export const routines = pgTable("routines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	position: integer().default(0).notNull(),
	active: boolean().default(true).notNull(),
	time_of_day: text().default('anytime').notNull(),
	specific_time: time(),
	reminder_enabled: boolean().default(false).notNull(),
	last_reminder_sent_date: date(),
	last_missed_sent_date: date(),
	goal_days: integer(),
	archived_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_routines_active_position").using("btree", table.active.asc().nullsLast().op("bool_ops"), table.position.asc().nullsLast().op("int4_ops")).where(sql`(active = true)`),
	index("idx_routines_archived").using("btree", table.archived_at.desc().nullsFirst().op("timestamptz_ops")).where(sql`(archived_at IS NOT NULL)`),
	index("idx_routines_reminder_time").using("btree", table.specific_time.asc().nullsLast().op("time_ops")).where(sql`((active = true) AND (reminder_enabled = true) AND (specific_time IS NOT NULL))`),
	check("routines_time_of_day_check", sql`time_of_day = ANY (ARRAY['morning'::text, 'afternoon'::text, 'evening'::text, 'anytime'::text])`),
	check("routines_goal_days_check", sql`(goal_days IS NULL) OR (goal_days > 0)`),
]);

export const routine_completions = pgTable("routine_completions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	routine_id: uuid().notNull(),
	completed_date: date().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_routine_completions_date").using("btree", table.completed_date.asc().nullsLast().op("date_ops")),
	index("idx_routine_completions_routine_date").using("btree", table.routine_id.asc().nullsLast().op("date_ops"), table.completed_date.desc().nullsFirst().op("date_ops")),
	foreignKey({
			columns: [table.routine_id],
			foreignColumns: [routines.id],
			name: "routine_completions_routine_id_fkey"
		}).onDelete("cascade"),
	unique("routine_completions_routine_id_completed_date_key").on(table.routine_id, table.completed_date),
]);

export const health_visits = pgTable("health_visits", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	visit_date: date().notNull(),
	provider_name: text(),
	provider_specialty: text(),
	visit_type: text(),
	reason: text(),
	assessment: text(),
	plan: text(),
	notes: text(),
	follow_up_date: date(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_health_visits_date").using("btree", table.visit_date.desc().nullsFirst().op("date_ops")),
	check("health_visits_visit_type_check", sql`visit_type = ANY (ARRAY['annual'::text, 'sick'::text, 'specialist'::text, 'follow_up'::text, 'lab'::text, 'imaging'::text, 'urgent_care'::text, 'emergency'::text, 'telehealth'::text, 'other'::text])`),
]);

export const wellbeing_check_ins = pgTable("wellbeing_check_ins", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	checked_in_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	mood: smallint(),
	energy: smallint(),
	sleep_quality: smallint(),
	pain: smallint(),
	notes: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_wellbeing_check_ins_time").using("btree", table.checked_in_at.desc().nullsFirst().op("timestamptz_ops")),
	check("wellbeing_check_ins_pain_check", sql`(pain >= 0) AND (pain <= 10)`),
	check("wellbeing_check_ins_mood_check", sql`(mood >= 1) AND (mood <= 5)`),
	check("wellbeing_check_ins_energy_check", sql`(energy >= 1) AND (energy <= 5)`),
	check("wellbeing_check_ins_sleep_quality_check", sql`(sleep_quality >= 1) AND (sleep_quality <= 5)`),
]);

export const health_metrics = pgTable("health_metrics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	measured_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	metric: text().notNull(),
	value: numeric({ mode: 'number' }),
	value_secondary: numeric({ mode: 'number' }),
	unit: text(),
	source: text().default('manual').notNull(),
	visit_id: uuid(),
	notes: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_health_metrics_metric_time").using("btree", table.metric.asc().nullsLast().op("text_ops"), table.measured_at.desc().nullsFirst().op("text_ops")),
	index("idx_health_metrics_source").using("btree", table.source.asc().nullsLast().op("text_ops")),
	index("idx_health_metrics_visit").using("btree", table.visit_id.asc().nullsLast().op("uuid_ops")).where(sql`(visit_id IS NOT NULL)`),
	foreignKey({
			columns: [table.visit_id],
			foreignColumns: [health_visits.id],
			name: "health_metrics_visit_id_fkey"
		}).onDelete("set null"),
	check("health_metrics_source_check", sql`source = ANY (ARRAY['manual'::text, 'garmin'::text, 'apple_health'::text, 'google_health'::text, 'whoop'::text, 'oura'::text, 'other'::text])`),
]);

export const lab_panels = pgTable("lab_panels", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	drawn_date: date().notNull(),
	panel_name: text().notNull(),
	ordering_provider: text(),
	lab_facility: text(),
	notes: text(),
	visit_id: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_panels_date").using("btree", table.drawn_date.desc().nullsFirst().op("date_ops")),
	index("idx_lab_panels_visit").using("btree", table.visit_id.asc().nullsLast().op("uuid_ops")).where(sql`(visit_id IS NOT NULL)`),
	foreignKey({
			columns: [table.visit_id],
			foreignColumns: [health_visits.id],
			name: "lab_panels_visit_id_fkey"
		}).onDelete("set null"),
]);

export const lab_results = pgTable("lab_results", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	panel_id: uuid().notNull(),
	analyte: text().notNull(),
	value: numeric({ mode: 'number' }),
	value_text: text(),
	unit: text(),
	reference_range_low: numeric({ mode: 'number' }),
	reference_range_high: numeric({ mode: 'number' }),
	reference_text: text(),
	flag: text(),
	notes: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_results_analyte").using("btree", table.analyte.asc().nullsLast().op("text_ops")),
	index("idx_lab_results_panel").using("btree", table.panel_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.panel_id],
			foreignColumns: [lab_panels.id],
			name: "lab_results_panel_id_fkey"
		}).onDelete("cascade"),
	check("lab_results_flag_check", sql`flag = ANY (ARRAY['low'::text, 'high'::text, 'critical_low'::text, 'critical_high'::text, 'abnormal'::text])`),
]);

export const medications = pgTable("medications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	kind: text().default('prescription').notNull(),
	dosage: text(),
	frequency: text(),
	prescribing_provider: text(),
	reason: text(),
	start_date: date(),
	stop_date: date(),
	active: boolean().default(true).notNull(),
	notes: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_medications_kind_active").using("btree", table.kind.asc().nullsLast().op("text_ops"), table.active.asc().nullsLast().op("text_ops")).where(sql`(active = true)`),
	check("medications_kind_check", sql`kind = ANY (ARRAY['prescription'::text, 'supplement'::text, 'vitamin'::text, 'otc'::text])`),
]);

export const health_documents = pgTable("health_documents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	storage_path: text().notNull(),
	filename: text().notNull(),
	mime_type: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	size_bytes: bigint({ mode: "number" }),
	document_type: text(),
	document_date: date(),
	visit_id: uuid(),
	panel_id: uuid(),
	notes: text(),
	ocr_status: text(),
	ocr_extracted: jsonb().$type<Record<string, unknown>>(),
	uploaded_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_health_documents_panel").using("btree", table.panel_id.asc().nullsLast().op("uuid_ops")).where(sql`(panel_id IS NOT NULL)`),
	index("idx_health_documents_uploaded").using("btree", table.uploaded_at.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_health_documents_visit").using("btree", table.visit_id.asc().nullsLast().op("uuid_ops")).where(sql`(visit_id IS NOT NULL)`),
	foreignKey({
			columns: [table.visit_id],
			foreignColumns: [health_visits.id],
			name: "health_documents_visit_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.panel_id],
			foreignColumns: [lab_panels.id],
			name: "health_documents_panel_id_fkey"
		}).onDelete("set null"),
	check("health_documents_document_type_check", sql`document_type = ANY (ARRAY['lab_report'::text, 'imaging_report'::text, 'visit_summary'::text, 'discharge_summary'::text, 'prescription'::text, 'vaccination_record'::text, 'insurance'::text, 'other'::text])`),
	check("health_documents_ocr_status_check", sql`ocr_status = ANY (ARRAY['pending'::text, 'parsed'::text, 'reviewed'::text, 'skipped'::text])`),
]);

export const workouts = pgTable("workouts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	ended_at: timestamp({ withTimezone: true, mode: 'string' }),
	duration_min: numeric({ mode: 'number' }),
	activity_type: text(),
	distance_m: numeric({ mode: 'number' }),
	avg_hr: smallint(),
	max_hr: smallint(),
	calories: integer(),
	elevation_gain_m: numeric({ mode: 'number' }),
	pace_sec_per_km: numeric({ mode: 'number' }),
	power_avg_watts: numeric({ mode: 'number' }),
	source: text().default('manual').notNull(),
	notes: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_workouts_started").using("btree", table.started_at.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_workouts_type_time").using("btree", table.activity_type.asc().nullsLast().op("text_ops"), table.started_at.desc().nullsFirst().op("text_ops")),
	check("workouts_source_check", sql`source = ANY (ARRAY['manual'::text, 'garmin'::text, 'apple_health'::text, 'google_health'::text, 'whoop'::text, 'strava'::text, 'other'::text])`),
]);

export const health_history = pgTable("health_history", {
	id: boolean().default(true).primaryKey().notNull(),
	narrative: text(),
	conditions: jsonb().$type<HealthHistoryItem[]>().default([]).notNull(),
	surgeries: jsonb().$type<HealthHistoryItem[]>().default([]).notNull(),
	allergies: jsonb().$type<HealthHistoryItem[]>().default([]).notNull(),
	immunizations: jsonb().$type<HealthHistoryItem[]>().default([]).notNull(),
	family_history: jsonb().$type<HealthHistoryItem[]>().default([]).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("health_history_id_check", sql`id`),
]);

export const auth_user = pgTable("auth_user", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	password_hash: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("auth_user_email_key").on(table.email),
]);

export const api_tokens = pgTable("api_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	token_hash: text().notNull(),
	kind: text().default('agent').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	last_used_at: timestamp({ withTimezone: true, mode: 'string' }),
	revoked_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("api_tokens_token_hash_key").on(table.token_hash),
	check("api_tokens_kind_check", sql`kind = ANY (ARRAY['agent'::text, 'device'::text])`),
]);

export const attention_items = pgTable("attention_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	rule_type: text().notNull(),
	source_type: text().notNull(),
	source_id: uuid().notNull(),
	title: text().notNull(),
	detail: text(),
	suggested_action: text(),
	score: real().default(0).notNull(),
	urgency: text().notNull(),
	first_surfaced_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	last_surfaced_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	surface_count: integer().default(1).notNull(),
	status: text().default('active').notNull(),
	snoozed_until: date(),
	dismissed_at: timestamp({ withTimezone: true, mode: 'string' }),
	acted_on_at: timestamp({ withTimezone: true, mode: 'string' }),
	acted_on_action: text(),
	dedup_key: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_attention_active").using("btree", table.status.asc().nullsLast().op("text_ops"), table.score.desc().nullsFirst().op("float4_ops")).where(sql`(status = 'active'::text)`),
	index("idx_attention_snoozed").using("btree", table.status.asc().nullsLast().op("text_ops"), table.snoozed_until.asc().nullsLast().op("date_ops")).where(sql`(status = 'snoozed'::text)`),
	index("idx_attention_source").using("btree", table.source_type.asc().nullsLast().op("text_ops"), table.source_id.asc().nullsLast().op("uuid_ops")),
	unique("attention_items_dedup_key_key").on(table.dedup_key),
	check("attention_items_source_type_check", sql`source_type = ANY (ARRAY['person'::text, 'company'::text, 'domain'::text, 'project'::text, 'conversation'::text, 'task'::text, 'content'::text])`),
	check("attention_items_urgency_check", sql`urgency = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text])`),
	check("attention_items_status_check", sql`status = ANY (ARRAY['active'::text, 'dismissed'::text, 'snoozed'::text, 'acted_on'::text, 'expired'::text])`),
]);
