-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"domain_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"type" text,
	"client_id" uuid,
	"quoted_hours" numeric(8, 2),
	"hours_logged" numeric(8, 2) DEFAULT '0' NOT NULL,
	"start_date" date,
	"target_date" date,
	"completed_at" timestamp with time zone,
	"color" text,
	"engagement_type" text DEFAULT 'project' NOT NULL,
	"kind" text DEFAULT 'project' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_status_check" CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'done'::text, 'archived'::text])),
	CONSTRAINT "projects_type_check" CHECK (type = ANY (ARRAY['client'::text, 'internal'::text, 'content'::text])),
	CONSTRAINT "projects_engagement_type_check" CHECK (engagement_type = ANY (ARRAY['project'::text, 'retainer'::text])),
	CONSTRAINT "projects_kind_check" CHECK (kind = ANY (ARRAY['project'::text, 'area'::text]))
);
--> statement-breakpoint
CREATE TABLE "stewardship_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fruit_definition" text,
	"failure_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_cadence" text,
	"active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"last_shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stewardship_domains_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"relationship_type" text,
	"email" text,
	"phone" text,
	"company" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_relationship_type_check" CHECK (relationship_type = ANY (ARRAY['client'::text, 'family'::text, 'church'::text, 'friend'::text, 'team'::text, 'vendor'::text, 'other'::text]))
);
--> statement-breakpoint
CREATE TABLE "person_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"fact_type" text NOT NULL,
	"fact_value" text NOT NULL,
	"source_ref" text,
	"date_relevant" date,
	"recurring" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_facts_fact_type_check" CHECK (fact_type = ANY (ARRAY['anniversary'::text, 'birthday'::text, 'kid_name'::text, 'shared'::text, 'follow_up'::text, 'other'::text]))
);
--> statement-breakpoint
CREATE TABLE "person_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"interaction_type" text NOT NULL,
	"notes" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_interactions_interaction_type_check" CHECK (interaction_type = ANY (ARRAY['email'::text, 'call'::text, 'in_person'::text, 'text'::text, 'meeting'::text, 'other'::text]))
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestones_status_check" CHECK (status = ANY (ARRAY['open'::text, 'done'::text])),
	CONSTRAINT "milestones_weight_check" CHECK (weight > 0)
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"entry" text NOT NULL,
	"hours_logged" numeric(6, 2),
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"kind" text DEFAULT 'work' NOT NULL,
	CONSTRAINT "activity_log_source_check" CHECK (source = ANY (ARRAY['manual'::text, 'voice'::text, 'email'::text, 'observation'::text, 'import'::text])),
	CONSTRAINT "activity_log_kind_check" CHECK (kind = ANY (ARRAY['work'::text, 'update'::text]))
);
--> statement-breakpoint
CREATE TABLE "project_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"recurrence_rule" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_checklist_items_recurrence_rule_check" CHECK (recurrence_rule = ANY (ARRAY['daily'::text, 'weekdays'::text, 'weekly'::text, 'biweekly'::text, 'monthly'::text, 'yearly'::text]))
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"domain_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'idea' NOT NULL,
	"outline_md" text,
	"video_url" text,
	"article_url" text,
	"published_at" timestamp with time zone,
	"parent_id" uuid,
	"derivative_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_type_check" CHECK (type = ANY (ARRAY['video'::text, 'article'::text, 'short_clip'::text, 'podcast_episode'::text, 'newsletter'::text])),
	CONSTRAINT "content_items_status_check" CHECK (status = ANY (ARRAY['idea'::text, 'outline'::text, 'filming'::text, 'editing'::text, 'published'::text, 'derivatives_pending'::text, 'done'::text]))
);
--> statement-breakpoint
CREATE TABLE "content_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"trigger_status" text NOT NULL,
	"derivative_type" text NOT NULL,
	"title_template" text NOT NULL,
	"default_due_offset_days" integer DEFAULT 7 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"due_date" date,
	"due_time" time,
	"priority" integer DEFAULT 4 NOT NULL,
	"project_id" uuid,
	"parent_task_id" uuid,
	"content_item_id" uuid,
	"domain_id" uuid NOT NULL,
	"recurrence_rule" text,
	"reminder_offsets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reminders_sent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"top3_for_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status_check" CHECK (status = ANY (ARRAY['open'::text, 'done'::text])),
	CONSTRAINT "tasks_priority_check" CHECK ((priority >= 1) AND (priority <= 4)),
	CONSTRAINT "tasks_source_check" CHECK (source = ANY (ARRAY['manual'::text, 'voice'::text, 'email'::text, 'observation'::text, 'import'::text]))
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_event_id" text,
	"title" text NOT NULL,
	"description" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'google' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_google_event_id_key" UNIQUE("google_event_id"),
	CONSTRAINT "calendar_events_source_check" CHECK (source = ANY (ARRAY['google'::text, 'created_here'::text]))
);
--> statement-breakpoint
CREATE TABLE "checklist_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid,
	"name" text NOT NULL,
	"linked_to_type" text,
	"linked_to_id" uuid,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_instances_linked_to_type_check" CHECK (linked_to_type = ANY (ARRAY['project'::text, 'event'::text, 'standalone'::text]))
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain_id" uuid,
	"description" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"isbn" text,
	"cover_image_url" text,
	"status" text DEFAULT 'want_to_read' NOT NULL,
	"format" text,
	"started_at" date,
	"finished_at" date,
	"rating" integer,
	"my_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_status_check" CHECK (status = ANY (ARRAY['reading'::text, 'finished'::text, 'abandoned'::text, 'want_to_read'::text])),
	CONSTRAINT "books_format_check" CHECK (format = ANY (ARRAY['physical'::text, 'kindle'::text, 'audiobook'::text])),
	CONSTRAINT "books_rating_check" CHECK ((rating >= 1) AND (rating <= 5))
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid,
	"text" text NOT NULL,
	"page_number" integer,
	"chapter" text,
	"source_type" text,
	"source_reference" text,
	"source_url" text,
	"source_author" text,
	"tags" text[] DEFAULT '{""}' NOT NULL,
	"added_via" text DEFAULT 'manual' NOT NULL,
	"last_surfaced_at" timestamp with time zone,
	"resurface_weight" numeric DEFAULT '1.0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_source_type_check" CHECK (source_type = ANY (ARRAY['book'::text, 'article'::text, 'podcast'::text, 'sermon'::text, 'video'::text, 'conversation'::text, 'other'::text])),
	CONSTRAINT "quotes_added_via_check" CHECK (added_via = ANY (ARRAY['voice'::text, 'readwise_import'::text, 'manual'::text, 'journal_extraction'::text])),
	CONSTRAINT "quotes_resurface_weight_check" CHECK (resurface_weight >= (0)::numeric)
);
--> statement-breakpoint
CREATE TABLE "quote_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"body" text NOT NULL,
	"annotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context" text DEFAULT 'unspecified',
	"tags" text[] DEFAULT '{""}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_annotations_context_check" CHECK (context = ANY (ARRAY['on_capture'::text, 'on_revisit'::text, 'on_surface'::text, 'unspecified'::text]))
);
--> statement-breakpoint
CREATE TABLE "journal_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_number" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_books_book_number_key" UNIQUE("book_number")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid,
	"entry_date" date NOT NULL,
	"image_path" text,
	"transcription_text" text,
	"source" text DEFAULT 'typed' NOT NULL,
	"tags" text[] DEFAULT '{""}' NOT NULL,
	"extracted_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resurface_weight" numeric DEFAULT '1.0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_source_check" CHECK (source = ANY (ARRAY['handwritten_photo'::text, 'voice'::text, 'typed'::text])),
	CONSTRAINT "journal_entries_resurface_weight_check" CHECK (resurface_weight >= (0)::numeric)
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body" text NOT NULL,
	"title" text,
	"source_type" text DEFAULT 'own_thought' NOT NULL,
	"source_reference" text,
	"related_quote_id" uuid,
	"needs_review" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{""}' NOT NULL,
	"related_project_id" uuid,
	"related_person_id" uuid,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resurface_weight" numeric DEFAULT '1.0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_source_type_check" CHECK (source_type = ANY (ARRAY['own_thought'::text, 'reading_response'::text, 'meeting_note'::text, 'brainstorm'::text, 'observation'::text, 'other'::text])),
	CONSTRAINT "notes_resurface_weight_check" CHECK (resurface_weight >= (0)::numeric)
);
--> statement-breakpoint
CREATE TABLE "inventory_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_depreciation_rate" numeric(5, 4),
	"insurance_relevant" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_categories_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"brand" text,
	"model" text,
	"serial_number" text,
	"purchase_date" date,
	"purchase_price" numeric(12, 2),
	"purchase_source" text,
	"current_value_estimate" numeric(12, 2),
	"value_updated_at" timestamp with time zone,
	"status" text DEFAULT 'owned' NOT NULL,
	"sold_date" date,
	"sold_price" numeric(12, 2),
	"sold_to" text,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"receipts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_status_check" CHECK (status = ANY (ARRAY['owned'::text, 'sold'::text, 'lost'::text, 'damaged'::text, 'loaned'::text]))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"source_ref" text,
	"source_url" text,
	"status" text DEFAULT 'unread' NOT NULL,
	"undo_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_status_check" CHECK (status = ANY (ARRAY['unread'::text, 'read'::text, 'dismissed'::text]))
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"supporting_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"domain_id" uuid,
	"project_id" uuid,
	"surfaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	"acted_on" boolean DEFAULT false NOT NULL,
	CONSTRAINT "observations_severity_check" CHECK (severity = ANY (ARRAY['info'::text, 'notable'::text, 'concerning'::text]))
);
--> statement-breakpoint
CREATE TABLE "action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_type" text NOT NULL,
	"target_system" text NOT NULL,
	"description" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"triggered_by" text NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_log_target_system_check" CHECK (target_system = ANY (ARRAY['drive'::text, 'gmail'::text, 'calendar'::text, 'internal'::text, 'anthropic'::text])),
	CONSTRAINT "action_log_status_check" CHECK (status = ANY (ARRAY['success'::text, 'failed'::text, 'pending'::text, 'undone'::text]))
);
--> statement-breakpoint
CREATE TABLE "google_oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"token_type" text DEFAULT 'Bearer' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"match_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_type" text NOT NULL,
	"action_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_state" text DEFAULT 'draft' NOT NULL,
	"confirmation_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_rules_action_type_check" CHECK (action_type = ANY (ARRAY['move_attachments_to_drive'::text, 'create_task'::text, 'notify_only'::text, 'extract_to_inbox'::text, 'tag'::text])),
	CONSTRAINT "email_rules_confidence_state_check" CHECK (confidence_state = ANY (ARRAY['draft'::text, 'learning'::text, 'auto'::text]))
);
--> statement-breakpoint
CREATE TABLE "resurfacing_seen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"surfaced_on" date DEFAULT CURRENT_DATE NOT NULL,
	"user_response" text,
	CONSTRAINT "resurfacing_seen_item_type_item_id_surfaced_on_key" UNIQUE("item_type","item_id","surfaced_on"),
	CONSTRAINT "resurfacing_seen_item_type_check" CHECK (item_type = ANY (ARRAY['journal'::text, 'quote'::text, 'verse'::text, 'win'::text, 'note'::text, 'project_milestone'::text])),
	CONSTRAINT "resurfacing_seen_user_response_check" CHECK (user_response = ANY (ARRAY['viewed'::text, 'dismissed'::text, 'saved'::text]))
);
--> statement-breakpoint
CREATE TABLE "captured_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{""}' NOT NULL,
	"display_hint" text DEFAULT 'log' NOT NULL,
	"processed_status" text DEFAULT 'raw' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captured_data_source_check" CHECK (source = ANY (ARRAY['zapier'::text, 'cowork'::text, 'n8n'::text, 'manual'::text, 'webhook'::text, 'smart_glasses'::text, 'watch'::text, 'other'::text])),
	CONSTRAINT "captured_data_display_hint_check" CHECK (display_hint = ANY (ARRAY['card'::text, 'log'::text, 'hidden'::text])),
	CONSTRAINT "captured_data_processed_status_check" CHECK (processed_status = ANY (ARRAY['raw'::text, 'parsed'::text, 'displayed'::text, 'archived'::text]))
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"timezone" text DEFAULT 'America/Denver' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_id_check" CHECK (CHECK (id))
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"time_of_day" text DEFAULT 'anytime' NOT NULL,
	"specific_time" time,
	"reminder_enabled" boolean DEFAULT false NOT NULL,
	"last_reminder_sent_date" date,
	"last_missed_sent_date" date,
	"goal_days" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routines_time_of_day_check" CHECK (time_of_day = ANY (ARRAY['morning'::text, 'afternoon'::text, 'evening'::text, 'anytime'::text])),
	CONSTRAINT "routines_goal_days_check" CHECK ((goal_days IS NULL) OR (goal_days > 0))
);
--> statement-breakpoint
CREATE TABLE "routine_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL,
	"completed_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routine_completions_routine_id_completed_date_key" UNIQUE("routine_id","completed_date")
);
--> statement-breakpoint
CREATE TABLE "health_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_date" date NOT NULL,
	"provider_name" text,
	"provider_specialty" text,
	"visit_type" text,
	"reason" text,
	"assessment" text,
	"plan" text,
	"notes" text,
	"follow_up_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_visits_visit_type_check" CHECK (visit_type = ANY (ARRAY['annual'::text, 'sick'::text, 'specialist'::text, 'follow_up'::text, 'lab'::text, 'imaging'::text, 'urgent_care'::text, 'emergency'::text, 'telehealth'::text, 'other'::text]))
);
--> statement-breakpoint
CREATE TABLE "wellbeing_check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mood" smallint,
	"energy" smallint,
	"sleep_quality" smallint,
	"pain" smallint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wellbeing_check_ins_pain_check" CHECK ((pain >= 0) AND (pain <= 10)),
	CONSTRAINT "wellbeing_check_ins_mood_check" CHECK ((mood >= 1) AND (mood <= 5)),
	CONSTRAINT "wellbeing_check_ins_energy_check" CHECK ((energy >= 1) AND (energy <= 5)),
	CONSTRAINT "wellbeing_check_ins_sleep_quality_check" CHECK ((sleep_quality >= 1) AND (sleep_quality <= 5))
);
--> statement-breakpoint
CREATE TABLE "health_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"metric" text NOT NULL,
	"value" numeric,
	"value_secondary" numeric,
	"unit" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"visit_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_metrics_source_check" CHECK (source = ANY (ARRAY['manual'::text, 'garmin'::text, 'apple_health'::text, 'google_health'::text, 'whoop'::text, 'oura'::text, 'other'::text]))
);
--> statement-breakpoint
CREATE TABLE "lab_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drawn_date" date NOT NULL,
	"panel_name" text NOT NULL,
	"ordering_provider" text,
	"lab_facility" text,
	"notes" text,
	"visit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"panel_id" uuid NOT NULL,
	"analyte" text NOT NULL,
	"value" numeric,
	"value_text" text,
	"unit" text,
	"reference_range_low" numeric,
	"reference_range_high" numeric,
	"reference_text" text,
	"flag" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_results_flag_check" CHECK (flag = ANY (ARRAY['low'::text, 'high'::text, 'critical_low'::text, 'critical_high'::text, 'abnormal'::text]))
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'prescription' NOT NULL,
	"dosage" text,
	"frequency" text,
	"prescribing_provider" text,
	"reason" text,
	"start_date" date,
	"stop_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medications_kind_check" CHECK (kind = ANY (ARRAY['prescription'::text, 'supplement'::text, 'vitamin'::text, 'otc'::text]))
);
--> statement-breakpoint
CREATE TABLE "health_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_path" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint,
	"document_type" text,
	"document_date" date,
	"visit_id" uuid,
	"panel_id" uuid,
	"notes" text,
	"ocr_status" text,
	"ocr_extracted" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_documents_document_type_check" CHECK (document_type = ANY (ARRAY['lab_report'::text, 'imaging_report'::text, 'visit_summary'::text, 'discharge_summary'::text, 'prescription'::text, 'vaccination_record'::text, 'insurance'::text, 'other'::text])),
	CONSTRAINT "health_documents_ocr_status_check" CHECK (ocr_status = ANY (ARRAY['pending'::text, 'parsed'::text, 'reviewed'::text, 'skipped'::text]))
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_min" numeric,
	"activity_type" text,
	"distance_m" numeric,
	"avg_hr" smallint,
	"max_hr" smallint,
	"calories" integer,
	"elevation_gain_m" numeric,
	"pace_sec_per_km" numeric,
	"power_avg_watts" numeric,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workouts_source_check" CHECK (source = ANY (ARRAY['manual'::text, 'garmin'::text, 'apple_health'::text, 'google_health'::text, 'whoop'::text, 'strava'::text, 'other'::text]))
);
--> statement-breakpoint
CREATE TABLE "health_history" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"narrative" text,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"surgeries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allergies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"immunizations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"family_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_history_id_check" CHECK (CHECK (id))
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_key" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."stewardship_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_facts" ADD CONSTRAINT "person_facts_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_interactions" ADD CONSTRAINT "person_interactions_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."stewardship_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_checklist_items" ADD CONSTRAINT "content_checklist_items_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."stewardship_domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."stewardship_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_annotations" ADD CONSTRAINT "quote_annotations_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."journal_books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_related_quote_id_fkey" FOREIGN KEY ("related_quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_related_project_id_fkey" FOREIGN KEY ("related_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_related_person_id_fkey" FOREIGN KEY ("related_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."stewardship_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_completions" ADD CONSTRAINT "routine_completions_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_metrics" ADD CONSTRAINT "health_metrics_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."health_visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_panels" ADD CONSTRAINT "lab_panels_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."health_visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "public"."lab_panels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_documents" ADD CONSTRAINT "health_documents_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."health_visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_documents" ADD CONSTRAINT "health_documents_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "public"."lab_panels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_projects_domain" ON "projects" USING btree ("domain_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_projects_kind_status" ON "projects" USING btree ("kind" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_projects_status" ON "projects" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_people_name_lower" ON "people" USING btree (lower(name) text_ops);--> statement-breakpoint
CREATE INDEX "idx_person_facts_date" ON "person_facts" USING btree ("date_relevant" date_ops) WHERE (date_relevant IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_person_facts_person" ON "person_facts" USING btree ("person_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_person_facts_type" ON "person_facts" USING btree ("fact_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_person_interactions_person_time" ON "person_interactions" USING btree ("person_id" timestamptz_ops,"occurred_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_milestones_project_position" ON "milestones" USING btree ("project_id" int4_ops,"position" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_activity_log_project_time" ON "activity_log" USING btree ("project_id" timestamptz_ops,"logged_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_project_checklist_items_project_position" ON "project_checklist_items" USING btree ("project_id" int4_ops,"position" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_content_items_domain_status" ON "content_items" USING btree ("domain_id" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_content_items_parent" ON "content_items" USING btree ("parent_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_content_checklist_items_content_position" ON "content_checklist_items" USING btree ("content_item_id" int4_ops,"position" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_tasks_content_item" ON "tasks" USING btree ("content_item_id" uuid_ops) WHERE (content_item_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_tasks_domain" ON "tasks" USING btree ("domain_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_tasks_parent" ON "tasks" USING btree ("parent_task_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_tasks_project" ON "tasks" USING btree ("project_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_tasks_status_due" ON "tasks" USING btree ("status" text_ops,"due_date" text_ops);--> statement-breakpoint
CREATE INDEX "idx_tasks_top3" ON "tasks" USING btree ("top3_for_date" date_ops) WHERE (top3_for_date IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_calendar_events_start" ON "calendar_events" USING btree ("start_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_checklist_instances_linked" ON "checklist_instances" USING btree ("linked_to_type" text_ops,"linked_to_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_quotes_last_surfaced" ON "quotes" USING btree ("last_surfaced_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_quotes_tags" ON "quotes" USING gin ("tags" array_ops);--> statement-breakpoint
CREATE INDEX "idx_quote_annotations_quote_time" ON "quote_annotations" USING btree ("quote_id" timestamptz_ops,"annotated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_quote_annotations_tags" ON "quote_annotations" USING gin ("tags" array_ops);--> statement-breakpoint
CREATE INDEX "idx_journal_entries_attachments" ON "journal_entries" USING gin ("attachments" jsonb_ops);--> statement-breakpoint
CREATE INDEX "idx_journal_entries_date" ON "journal_entries" USING btree ("entry_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_journal_entries_tags" ON "journal_entries" USING gin ("tags" array_ops);--> statement-breakpoint
CREATE INDEX "idx_notes_attachments" ON "notes" USING gin ("attachments" jsonb_ops);--> statement-breakpoint
CREATE INDEX "idx_notes_needs_review" ON "notes" USING btree ("needs_review" bool_ops) WHERE (needs_review = true);--> statement-breakpoint
CREATE INDEX "idx_notes_related_quote" ON "notes" USING btree ("related_quote_id" uuid_ops) WHERE (related_quote_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_notes_source_type" ON "notes" USING btree ("source_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_notes_tags" ON "notes" USING gin ("tags" array_ops);--> statement-breakpoint
CREATE INDEX "idx_notes_title" ON "notes" USING btree ("title" text_ops) WHERE (title IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_inventory_items_category" ON "inventory_items" USING btree ("category" text_ops);--> statement-breakpoint
CREATE INDEX "idx_inventory_items_status" ON "inventory_items" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_status_time" ON "notifications" USING btree ("status" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "idx_observations_active" ON "observations" USING btree ("surfaced_at" timestamptz_ops) WHERE (dismissed_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_action_log_time" ON "action_log" USING btree ("executed_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_captured_data_tags" ON "captured_data" USING gin ("tags" array_ops);--> statement-breakpoint
CREATE INDEX "idx_captured_data_type_time" ON "captured_data" USING btree ("type" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "idx_routines_active_position" ON "routines" USING btree ("active" bool_ops,"position" int4_ops) WHERE (active = true);--> statement-breakpoint
CREATE INDEX "idx_routines_archived" ON "routines" USING btree ("archived_at" timestamptz_ops) WHERE (archived_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_routines_reminder_time" ON "routines" USING btree ("specific_time" time_ops) WHERE ((active = true) AND (reminder_enabled = true) AND (specific_time IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_routine_completions_date" ON "routine_completions" USING btree ("completed_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_routine_completions_routine_date" ON "routine_completions" USING btree ("routine_id" date_ops,"completed_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_health_visits_date" ON "health_visits" USING btree ("visit_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_wellbeing_check_ins_time" ON "wellbeing_check_ins" USING btree ("checked_in_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_health_metrics_metric_time" ON "health_metrics" USING btree ("metric" text_ops,"measured_at" text_ops);--> statement-breakpoint
CREATE INDEX "idx_health_metrics_source" ON "health_metrics" USING btree ("source" text_ops);--> statement-breakpoint
CREATE INDEX "idx_health_metrics_visit" ON "health_metrics" USING btree ("visit_id" uuid_ops) WHERE (visit_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_lab_panels_date" ON "lab_panels" USING btree ("drawn_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_lab_panels_visit" ON "lab_panels" USING btree ("visit_id" uuid_ops) WHERE (visit_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_lab_results_analyte" ON "lab_results" USING btree ("analyte" text_ops);--> statement-breakpoint
CREATE INDEX "idx_lab_results_panel" ON "lab_results" USING btree ("panel_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_medications_kind_active" ON "medications" USING btree ("kind" text_ops,"active" text_ops) WHERE (active = true);--> statement-breakpoint
CREATE INDEX "idx_health_documents_panel" ON "health_documents" USING btree ("panel_id" uuid_ops) WHERE (panel_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_health_documents_uploaded" ON "health_documents" USING btree ("uploaded_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_health_documents_visit" ON "health_documents" USING btree ("visit_id" uuid_ops) WHERE (visit_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_workouts_started" ON "workouts" USING btree ("started_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_workouts_type_time" ON "workouts" USING btree ("activity_type" text_ops,"started_at" text_ops);
*/