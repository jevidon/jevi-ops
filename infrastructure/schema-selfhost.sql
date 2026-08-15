-- ─────────────────────────────────────────────────────────────────────────
-- jevi-ops — self-hosted Postgres schema (DDL only)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Portable schema for plain PostgreSQL (no Supabase). Safe to run ONCE
-- against a fresh database:  psql "$DATABASE_URL" -f schema-selfhost.sql
--
-- What this file does:
--   1. Creates all tables (final column shape post-alters).
--   2. Creates indexes.
--   3. Installs the set_updated_at() trigger + attaches it.
--   4. Creates the auth_user table (self-issued JWT auth — no GoTrue).
--
-- What it does NOT do:
--   - Seed data. Fresh installs run seed.sql afterwards; migrations from a
--     Supabase deployment restore a data dump instead (see MIGRATION.md).
--   - RLS. Single-tenant direct connection; the app is the trust boundary.
--
-- ─────────────────────────────────────────────────────────────────────────

-- Required extensions ─────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- set_updated_at trigger function ─────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ─────────────────────────────────────────────────────────────────────────
-- Core: stewardship domains
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists stewardship_domains (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  fruit_definition text,
  failure_patterns jsonb not null default '[]'::jsonb,
  expected_cadence text,
  active boolean not null default true,
  is_system boolean not null default false,
  last_shipped_at timestamptz,
  illustration jsonb,
  illustration_draft jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_stewardship_domains_updated_at on stewardship_domains;
create trigger trg_stewardship_domains_updated_at
  before update on stewardship_domains
  for each row execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
-- People & relationships
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  relationship_type text check (relationship_type in
    ('client','family','church','friend','team','vendor','other')),
  email text,
  phone text,
  company text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_people_name_lower on people (lower(name));

drop trigger if exists trg_people_updated_at on people;
create trigger trg_people_updated_at
  before update on people
  for each row execute function set_updated_at();

create table if not exists person_facts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  fact_type text not null check (fact_type in
    ('anniversary','birthday','kid_name','shared','follow_up','other')),
  fact_value text not null,
  source_ref text,
  date_relevant date,
  recurring boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_person_facts_person on person_facts(person_id);
create index if not exists idx_person_facts_type on person_facts(fact_type);
create index if not exists idx_person_facts_date on person_facts(date_relevant)
  where date_relevant is not null;

create table if not exists person_interactions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  interaction_type text not null check (interaction_type in
    ('email','call','in_person','text','meeting','other')),
  notes text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_person_interactions_person_time
  on person_interactions(person_id, occurred_at desc);


-- ─────────────────────────────────────────────────────────────────────────
-- Projects, milestones, activity
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  domain_id uuid references stewardship_domains(id) on delete set null,
  status text not null default 'active' check (status in
    ('active','paused','done','archived')),
  type text check (type in ('client','internal','content')),
  client_id uuid references people(id) on delete set null,
  quoted_hours numeric(8,2),
  hours_logged numeric(8,2) not null default 0,
  start_date date,
  target_date date,
  completed_at timestamptz,
  color text,
  engagement_type text not null default 'project' check (engagement_type in
    ('project','retainer')),
  kind text not null default 'project' check (kind in ('project','area')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_status on projects(status);
create index if not exists idx_projects_domain on projects(domain_id);
create index if not exists idx_projects_kind_status on projects(kind, status);

drop trigger if exists trg_projects_updated_at on projects;
create trigger trg_projects_updated_at
  before update on projects
  for each row execute function set_updated_at();

create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  status text not null default 'open' check (status in ('open','done')),
  weight integer not null default 1 check (weight > 0),
  position integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_milestones_project_position
  on milestones(project_id, position);

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  entry text not null,
  hours_logged numeric(6,2),
  logged_at timestamptz not null default now(),
  source text not null default 'manual' check (source in
    ('manual','voice','email','observation','import')),
  kind text not null default 'work' check (kind in ('work','update'))
);

create index if not exists idx_activity_log_project_time
  on activity_log(project_id, logged_at desc);

create table if not exists project_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  position integer not null default 0,
  title text not null,
  done boolean not null default false,
  done_at timestamptz,
  recurrence_rule text check (recurrence_rule in
    ('daily','weekdays','weekly','biweekly','monthly','quarterly','semiannually','yearly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_checklist_items_project_position
  on project_checklist_items(project_id, position);

drop trigger if exists trg_project_checklist_items_updated_at on project_checklist_items;
create trigger trg_project_checklist_items_updated_at
  before update on project_checklist_items
  for each row execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
-- Content pipeline (created before tasks so tasks.content_item_id resolves)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  domain_id uuid references stewardship_domains(id) on delete set null,
  type text not null check (type in
    ('video','article','short_clip','podcast_episode','newsletter')),
  status text not null default 'idea' check (status in
    ('idea','outline','filming','editing','published','derivatives_pending','done')),
  outline_md text,
  video_url text,
  article_url text,
  published_at timestamptz,
  parent_id uuid references content_items(id) on delete set null,
  derivative_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_content_items_domain_status
  on content_items(domain_id, status);
create index if not exists idx_content_items_parent on content_items(parent_id);

drop trigger if exists trg_content_items_updated_at on content_items;
create trigger trg_content_items_updated_at
  before update on content_items
  for each row execute function set_updated_at();

create table if not exists content_checklist_items (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  position integer not null default 0,
  title text not null,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_content_checklist_items_content_position
  on content_checklist_items(content_item_id, position);

drop trigger if exists trg_content_checklist_items_updated_at on content_checklist_items;
create trigger trg_content_checklist_items_updated_at
  before update on content_checklist_items
  for each row execute function set_updated_at();

create table if not exists content_templates (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  trigger_status text not null,
  derivative_type text not null,
  title_template text not null,
  default_due_offset_days integer not null default 7,
  active boolean not null default true,
  created_at timestamptz not null default now()
);


-- ─────────────────────────────────────────────────────────────────────────
-- Tasks
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  status text not null default 'open' check (status in ('open','done')),
  due_date date,
  due_time time,
  priority integer not null default 4 check (priority between 1 and 4),
  project_id uuid references projects(id) on delete set null,
  parent_task_id uuid references tasks(id) on delete cascade,
  content_item_id uuid references content_items(id) on delete set null,
  -- App-enforced: must belong to the task's project (no cross-table CHECK).
  milestone_id uuid references milestones(id) on delete set null,
  domain_id uuid not null references stewardship_domains(id),
  recurrence_rule text,
  reminder_offsets jsonb not null default '[]'::jsonb,
  reminders_sent jsonb not null default '{}'::jsonb,
  source text not null default 'manual' check (source in
    ('manual','voice','email','observation','import')),
  top3_for_date date,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_status_due on tasks(status, due_date);
create index if not exists idx_tasks_project on tasks(project_id);
create index if not exists idx_tasks_parent on tasks(parent_task_id);
create index if not exists idx_tasks_domain on tasks(domain_id);
create index if not exists idx_tasks_top3 on tasks(top3_for_date)
  where top3_for_date is not null;
create index if not exists idx_tasks_content_item on tasks(content_item_id)
  where content_item_id is not null;
create index if not exists tasks_milestone_id_idx on tasks(milestone_id);

drop trigger if exists trg_tasks_updated_at on tasks;
create trigger trg_tasks_updated_at
  before update on tasks
  for each row execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
-- Calendar
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  google_event_id text unique,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  location text,
  attendees jsonb not null default '[]'::jsonb,
  source text not null default 'google' check (source in ('google','created_here')),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_calendar_events_start on calendar_events(start_at);

drop trigger if exists trg_calendar_events_updated_at on calendar_events;
create trigger trg_calendar_events_updated_at
  before update on calendar_events
  for each row execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
-- Checklists (generic, template-based)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain_id uuid references stewardship_domains(id) on delete set null,
  description text,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists checklist_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references checklist_templates(id) on delete set null,
  name text not null,
  linked_to_type text check (linked_to_type in ('project','event','standalone')),
  linked_to_id uuid,
  items jsonb not null default '[]'::jsonb,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_checklist_instances_linked
  on checklist_instances(linked_to_type, linked_to_id);


-- ─────────────────────────────────────────────────────────────────────────
-- Books, quotes, quote annotations
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  isbn text,
  cover_image_url text,
  status text not null default 'want_to_read' check (status in
    ('reading','finished','abandoned','want_to_read')),
  format text check (format in ('physical','kindle','audiobook')),
  started_at date,
  finished_at date,
  rating integer check (rating between 1 and 5),
  my_summary text,
  created_at timestamptz not null default now()
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references books(id) on delete set null,
  text text not null,
  page_number integer,
  chapter text,
  source_type text check (source_type in
    ('book','article','podcast','sermon','video','conversation','other')),
  source_reference text,
  source_url text,
  source_author text,
  tags text[] not null default '{}',
  added_via text not null default 'manual' check (added_via in
    ('voice','readwise_import','manual','journal_extraction')),
  last_surfaced_at timestamptz,
  resurface_weight numeric not null default 1.0 check (resurface_weight >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_quotes_tags on quotes using gin(tags);
create index if not exists idx_quotes_last_surfaced
  on quotes(last_surfaced_at nulls first);

create table if not exists quote_annotations (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  body text not null,
  annotated_at timestamptz not null default now(),
  context text default 'unspecified' check (context in
    ('on_capture','on_revisit','on_surface','unspecified')),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quote_annotations_quote_time
  on quote_annotations(quote_id, annotated_at desc);
create index if not exists idx_quote_annotations_tags
  on quote_annotations using gin(tags);

drop trigger if exists trg_quote_annotations_updated_at on quote_annotations;
create trigger trg_quote_annotations_updated_at
  before update on quote_annotations
  for each row execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
-- Journal
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists journal_books (
  id uuid primary key default gen_random_uuid(),
  book_number integer not null unique,
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references journal_books(id) on delete set null,
  entry_date date not null,
  image_path text,
  transcription_text text,
  source text not null default 'typed' check (source in
    ('handwritten_photo','voice','typed')),
  tags text[] not null default '{}',
  extracted_facts jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  resurface_weight numeric not null default 1.0 check (resurface_weight >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_journal_entries_date
  on journal_entries(entry_date desc);
create index if not exists idx_journal_entries_tags
  on journal_entries using gin(tags);
create index if not exists idx_journal_entries_attachments
  on journal_entries using gin(attachments);


-- ─────────────────────────────────────────────────────────────────────────
-- Notes (references quotes for related_quote_id)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  title text,
  source_type text not null default 'own_thought' check (source_type in
    ('own_thought','reading_response','meeting_note','brainstorm','observation','other')),
  source_reference text,
  related_quote_id uuid references quotes(id) on delete set null,
  needs_review boolean not null default false,
  tags text[] not null default '{}',
  related_project_id uuid references projects(id) on delete set null,
  related_person_id uuid references people(id) on delete set null,
  attachments jsonb not null default '[]'::jsonb,
  resurface_weight numeric not null default 1.0 check (resurface_weight >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_notes_tags on notes using gin(tags);
create index if not exists idx_notes_title on notes(title) where title is not null;
create index if not exists idx_notes_source_type on notes(source_type);
create index if not exists idx_notes_needs_review on notes(needs_review) where needs_review = true;
create index if not exists idx_notes_related_quote on notes(related_quote_id)
  where related_quote_id is not null;
create index if not exists idx_notes_attachments on notes using gin(attachments);


-- ─────────────────────────────────────────────────────────────────────────
-- Inventory
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_depreciation_rate numeric(5,4),
  insurance_relevant boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  brand text,
  model text,
  serial_number text,
  purchase_date date,
  purchase_price numeric(12,2),
  purchase_source text,
  current_value_estimate numeric(12,2),
  value_updated_at timestamptz,
  status text not null default 'owned' check (status in
    ('owned','sold','lost','damaged','loaned')),
  sold_date date,
  sold_price numeric(12,2),
  sold_to text,
  photos jsonb not null default '[]'::jsonb,
  receipts jsonb not null default '[]'::jsonb,
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_items_category on inventory_items(category);
create index if not exists idx_inventory_items_status on inventory_items(status);

drop trigger if exists trg_inventory_items_updated_at on inventory_items;
create trigger trg_inventory_items_updated_at
  before update on inventory_items
  for each row execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
-- Notifications, observations, action log, email rules, resurfacing seen
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  body text,
  source_ref text,
  source_url text,
  status text not null default 'unread' check (status in
    ('unread','read','dismissed')),
  undo_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_status_time
  on notifications(status, created_at desc);

create table if not exists observations (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  severity text not null default 'info' check (severity in
    ('info','notable','concerning')),
  title text not null,
  body text,
  supporting_data jsonb not null default '{}'::jsonb,
  domain_id uuid references stewardship_domains(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  surfaced_at timestamptz not null default now(),
  dismissed_at timestamptz,
  acted_on boolean not null default false
);

create index if not exists idx_observations_active
  on observations(surfaced_at desc)
  where dismissed_at is null;

create table if not exists action_log (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  target_system text not null check (target_system in
    ('drive','gmail','calendar','internal','anthropic')),
  description text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'success' check (status in
    ('success','failed','pending','undone')),
  triggered_by text not null,
  executed_at timestamptz not null default now()
);

create index if not exists idx_action_log_time on action_log(executed_at desc);

create table if not exists email_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  match_criteria jsonb not null default '{}'::jsonb,
  action_type text not null check (action_type in
    ('move_attachments_to_drive','create_task','notify_only','extract_to_inbox','tag')),
  action_params jsonb not null default '{}'::jsonb,
  confidence_state text not null default 'draft' check (confidence_state in
    ('draft','learning','auto')),
  confirmation_count integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists resurfacing_seen (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in
    ('journal','quote','verse','win','note','project_milestone')),
  item_id uuid not null,
  surfaced_on date not null default current_date,
  user_response text check (user_response in ('viewed','dismissed','saved')),
  unique (item_type, item_id, surfaced_on)
);


-- ─────────────────────────────────────────────────────────────────────────
-- Captured data (webhook/voice/watch ingest firehose)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists captured_data (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in
    ('zapier','cowork','n8n','manual','webhook','smart_glasses','watch','other')),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  display_hint text not null default 'log' check (display_hint in
    ('card','log','hidden')),
  processed_status text not null default 'raw' check (processed_status in
    ('raw','parsed','displayed','archived')),
  source_ref text,
  created_at timestamptz not null default now()
);

create index if not exists idx_captured_data_type_time
  on captured_data(type, created_at desc);
create index if not exists idx_captured_data_tags
  on captured_data using gin(tags);


-- ─────────────────────────────────────────────────────────────────────────
-- Google OAuth (service-role only; RLS enabled without policies)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists google_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text not null,
  token_type text not null default 'Bearer',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_google_oauth_tokens_updated_at on google_oauth_tokens;
create trigger trg_google_oauth_tokens_updated_at
  before update on google_oauth_tokens
  for each row execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
-- App settings (singleton)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists app_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'America/Denver',
  -- Dashboard-editable integration config (env vars act as fallback):
  -- LLM (OpenAI-compatible endpoint or 'anthropic'), STT, Immich.
  llm_provider text check (llm_provider in ('openai_compatible', 'anthropic')),
  llm_base_url text,
  llm_model text,
  llm_api_key text,
  stt_base_url text,
  stt_model text,
  immich_base_url text,
  immich_api_key text,
  -- Module feature flags (migration 0036). rule_module_enabled exists
  -- because the Editorial v2 web tree checks it; the module isn't ported.
  health_module_enabled boolean not null default false,
  routines_module_enabled boolean not null default true,
  rule_module_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_app_settings_updated_at on app_settings;
create trigger trg_app_settings_updated_at
  before update on app_settings
  for each row execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
-- Routines
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  position integer not null default 0,
  active boolean not null default true,
  time_of_day text not null default 'anytime' check (time_of_day in
    ('morning','afternoon','evening','anytime')),
  specific_time time,
  reminder_enabled boolean not null default false,
  last_reminder_sent_date date,
  last_missed_sent_date date,
  goal_days integer check (goal_days is null or goal_days > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_routines_active_position
  on routines(active, position) where active = true;
create index if not exists idx_routines_reminder_time
  on routines(specific_time)
  where active = true and reminder_enabled = true and specific_time is not null;
create index if not exists idx_routines_archived
  on routines(archived_at desc) where archived_at is not null;

drop trigger if exists trg_routines_updated_at on routines;
create trigger trg_routines_updated_at
  before update on routines
  for each row execute function set_updated_at();

create table if not exists routine_completions (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references routines(id) on delete cascade,
  completed_date date not null,
  created_at timestamptz not null default now(),
  unique (routine_id, completed_date)
);

create index if not exists idx_routine_completions_routine_date
  on routine_completions(routine_id, completed_date desc);
create index if not exists idx_routine_completions_date
  on routine_completions(completed_date);


-- ─────────────────────────────────────────────────────────────────────────
-- Health subsystem
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists health_visits (
  id uuid primary key default gen_random_uuid(),
  visit_date date not null,
  provider_name text,
  provider_specialty text,
  visit_type text check (visit_type in
    ('annual','sick','specialist','follow_up','lab','imaging',
     'urgent_care','emergency','telehealth','other')),
  reason text,
  assessment text,
  plan text,
  notes text,
  follow_up_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_health_visits_date on health_visits(visit_date desc);

drop trigger if exists trg_health_visits_updated_at on health_visits;
create trigger trg_health_visits_updated_at
  before update on health_visits
  for each row execute function set_updated_at();

create table if not exists health_metrics (
  id uuid primary key default gen_random_uuid(),
  measured_at timestamptz not null,
  metric text not null,
  value numeric,
  value_secondary numeric,
  unit text,
  source text not null default 'manual' check (source in
    ('manual','garmin','apple_health','google_health','whoop','oura','other')),
  visit_id uuid references health_visits(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_health_metrics_metric_time
  on health_metrics(metric, measured_at desc);
create index if not exists idx_health_metrics_source on health_metrics(source);
create index if not exists idx_health_metrics_visit on health_metrics(visit_id)
  where visit_id is not null;

drop trigger if exists trg_health_metrics_updated_at on health_metrics;
create trigger trg_health_metrics_updated_at
  before update on health_metrics
  for each row execute function set_updated_at();

create table if not exists lab_panels (
  id uuid primary key default gen_random_uuid(),
  drawn_date date not null,
  panel_name text not null,
  ordering_provider text,
  lab_facility text,
  notes text,
  visit_id uuid references health_visits(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lab_panels_date on lab_panels(drawn_date desc);
create index if not exists idx_lab_panels_visit on lab_panels(visit_id)
  where visit_id is not null;

drop trigger if exists trg_lab_panels_updated_at on lab_panels;
create trigger trg_lab_panels_updated_at
  before update on lab_panels
  for each row execute function set_updated_at();

create table if not exists lab_results (
  id uuid primary key default gen_random_uuid(),
  panel_id uuid not null references lab_panels(id) on delete cascade,
  analyte text not null,
  value numeric,
  value_text text,
  unit text,
  reference_range_low numeric,
  reference_range_high numeric,
  reference_text text,
  flag text check (flag in ('low','high','critical_low','critical_high','abnormal')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_lab_results_panel on lab_results(panel_id);
create index if not exists idx_lab_results_analyte on lab_results(analyte);

create table if not exists wellbeing_check_ins (
  id uuid primary key default gen_random_uuid(),
  checked_in_at timestamptz not null default now(),
  mood smallint check (mood between 1 and 5),
  energy smallint check (energy between 1 and 5),
  sleep_quality smallint check (sleep_quality between 1 and 5),
  pain smallint check (pain between 0 and 10),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_wellbeing_check_ins_time
  on wellbeing_check_ins(checked_in_at desc);

create table if not exists medications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'prescription' check (kind in
    ('prescription','supplement','vitamin','otc')),
  dosage text,
  frequency text,
  prescribing_provider text,
  reason text,
  start_date date,
  stop_date date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_medications_kind_active
  on medications(kind, active) where active = true;

drop trigger if exists trg_medications_updated_at on medications;
create trigger trg_medications_updated_at
  before update on medications
  for each row execute function set_updated_at();

create table if not exists health_documents (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint,
  document_type text check (document_type in
    ('lab_report','imaging_report','visit_summary','discharge_summary',
     'prescription','vaccination_record','insurance','other')),
  document_date date,
  visit_id uuid references health_visits(id) on delete set null,
  panel_id uuid references lab_panels(id) on delete set null,
  notes text,
  ocr_status text check (ocr_status in ('pending','parsed','reviewed','skipped')),
  ocr_extracted jsonb,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_health_documents_visit on health_documents(visit_id)
  where visit_id is not null;
create index if not exists idx_health_documents_panel on health_documents(panel_id)
  where panel_id is not null;
create index if not exists idx_health_documents_uploaded
  on health_documents(uploaded_at desc);

drop trigger if exists trg_health_documents_updated_at on health_documents;
create trigger trg_health_documents_updated_at
  before update on health_documents
  for each row execute function set_updated_at();

create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_min numeric,
  activity_type text,
  distance_m numeric,
  avg_hr smallint,
  max_hr smallint,
  calories integer,
  elevation_gain_m numeric,
  pace_sec_per_km numeric,
  power_avg_watts numeric,
  source text not null default 'manual' check (source in
    ('manual','garmin','apple_health','google_health','whoop','strava','other')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_workouts_started on workouts(started_at desc);
create index if not exists idx_workouts_type_time
  on workouts(activity_type, started_at desc);

create table if not exists health_history (
  id boolean primary key default true check (id),
  narrative text,
  conditions jsonb not null default '[]'::jsonb,
  surgeries jsonb not null default '[]'::jsonb,
  allergies jsonb not null default '[]'::jsonb,
  immunizations jsonb not null default '[]'::jsonb,
  family_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_health_history_updated_at on health_history;
create trigger trg_health_history_updated_at
  before update on health_history
  for each row execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
-- Auth: single-user credential store (replaces Supabase GoTrue)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists auth_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- Named bearer credentials for agents (Hermes/OpenClaw) and future edge
-- capture devices. Token value is shown once at creation; only the
-- SHA-256 hash is stored. Revocation = set revoked_at.
create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  kind text not null default 'agent' check (kind in ('agent', 'device')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);


-- ─────────────────────────────────────────────────────────────────────────
-- Attention Engine (migration 0035)
-- ─────────────────────────────────────────────────────────────────────────
-- Daily rule engine output — "what needs my attention right now?" items
-- with a score → urgency and a snooze/dismiss/acted lifecycle. See
-- apps/api/src/lib/attention.ts. source_type keeps the upstream vocabulary
-- (company/conversation included) so a future CRM port needs no change.

create table if not exists attention_items (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null,
  source_type text not null check (source_type in
    ('person','company','domain','project','conversation','task','content')),
  source_id uuid not null,
  title text not null,
  detail text,
  suggested_action text,
  score real not null default 0,
  urgency text not null check (urgency in ('low','normal','high')),
  first_surfaced_at timestamptz not null default now(),
  last_surfaced_at timestamptz not null default now(),
  surface_count integer not null default 1,
  status text not null default 'active' check (status in
    ('active','dismissed','snoozed','acted_on','expired')),
  snoozed_until date,
  dismissed_at timestamptz,
  acted_on_at timestamptz,
  acted_on_action text,
  dedup_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_attention_active
  on attention_items(status, score desc) where status = 'active';
create index if not exists idx_attention_snoozed
  on attention_items(status, snoozed_until) where status = 'snoozed';
create index if not exists idx_attention_source
  on attention_items(source_type, source_id);


-- ─────────────────────────────────────────────────────────────────────────
-- Tomorrow's Focus (migration 0037)
-- ─────────────────────────────────────────────────────────────────────────
-- One optional pointer per day at a project or content item. No status, no
-- completion, no adherence tracking — a pointer, not a flow. target_id has
-- no FK (spans two tables); validated app-side.

create table if not exists daily_focus (
  date date primary key,
  target_type text not null check (target_type in ('project','content_item')),
  target_id uuid not null,
  note text,
  created_at timestamptz not null default now()
);


-- ─────────────────────────────────────────────────────────────────────────
-- Done.
-- ─────────────────────────────────────────────────────────────────────────
