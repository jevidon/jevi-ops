-- Personal Operations Dashboard — initial schema
-- Matches spec v1 section 6. Single-user system; row-level security
-- is enforced via Supabase Auth + policies in a later migration.
--
-- Conventions:
--   * snake_case table + column names
--   * uuid primary keys (gen_random_uuid())
--   * timestamptz everywhere
--   * jsonb for flexible payloads
--   * CHECK constraints over enums to keep migrations cheap

create extension if not exists "pgcrypto";

-- ─── Domains (higher-level groupings above projects) ─────────────────────
create table stewardship_domains (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique,
  description         text,
  fruit_definition    text,
  failure_patterns    jsonb not null default '[]'::jsonb,
  expected_cadence    text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─── People (CRM layer) ──────────────────────────────────────────────────
create table people (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  relationship_type   text check (relationship_type in
                        ('client','family','church','friend','team','vendor','other')),
  email               text,
  phone               text,
  company             text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index people_name_idx on people (lower(name));

create table person_facts (
  id                  uuid primary key default gen_random_uuid(),
  person_id           uuid not null references people(id) on delete cascade,
  fact_type           text not null check (fact_type in
                        ('anniversary','birthday','kid_name','shared','follow_up','other')),
  fact_value          text not null,
  source_ref          text,
  date_relevant       date,
  recurring           boolean not null default false,
  created_at          timestamptz not null default now()
);
create index person_facts_person_idx on person_facts (person_id);
create index person_facts_date_idx   on person_facts (date_relevant) where date_relevant is not null;

create table person_interactions (
  id                  uuid primary key default gen_random_uuid(),
  person_id           uuid not null references people(id) on delete cascade,
  interaction_type    text not null check (interaction_type in
                        ('email','call','in_person','text','meeting','other')),
  notes               text,
  occurred_at         timestamptz not null default now()
);
create index person_interactions_person_idx on person_interactions (person_id, occurred_at desc);

-- ─── Projects + milestones + activity ────────────────────────────────────
create table projects (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  domain_id           uuid references stewardship_domains(id) on delete set null,
  status              text not null default 'active'
                        check (status in ('active','paused','done','archived')),
  type                text check (type in ('client','internal','content')),
  client_id           uuid references people(id) on delete set null,
  quoted_hours        numeric(8,2),
  hours_logged        numeric(8,2) not null default 0,
  start_date          date,
  target_date         date,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index projects_status_idx on projects (status);
create index projects_domain_idx on projects (domain_id);

create table milestones (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  title               text not null,
  status              text not null default 'open' check (status in ('open','done')),
  weight              integer not null default 1 check (weight > 0),
  position            integer not null default 0,
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index milestones_project_idx on milestones (project_id, position);

create table activity_log (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid references projects(id) on delete cascade,
  entry               text not null,
  hours_logged        numeric(6,2),
  logged_at           timestamptz not null default now(),
  source              text not null default 'manual'
                        check (source in ('manual','voice','email','observation','import'))
);
create index activity_log_project_idx on activity_log (project_id, logged_at desc);

-- ─── Tasks ───────────────────────────────────────────────────────────────
create table tasks (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  notes               text,
  status              text not null default 'open' check (status in ('open','done')),
  due_date            date,
  due_time            time,
  priority            integer not null default 4 check (priority between 1 and 4),
  project_id          uuid references projects(id) on delete set null,
  parent_task_id      uuid references tasks(id) on delete cascade,
  recurrence_rule     text,
  reminder_offsets    jsonb not null default '[]'::jsonb,
  source              text not null default 'manual'
                        check (source in ('manual','voice','email','observation','import')),
  -- Mark which day this task is one of the "top 3 for today"
  top3_for_date       date,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  updated_at          timestamptz not null default now()
);
create index tasks_status_due_idx       on tasks (status, due_date);
create index tasks_project_idx          on tasks (project_id);
create index tasks_parent_idx           on tasks (parent_task_id);
create index tasks_top3_idx             on tasks (top3_for_date) where top3_for_date is not null;

-- ─── Calendar ────────────────────────────────────────────────────────────
create table calendar_events (
  id                  uuid primary key default gen_random_uuid(),
  google_event_id     text unique,
  title               text not null,
  description         text,
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  all_day             boolean not null default false,
  location            text,
  attendees           jsonb not null default '[]'::jsonb,
  source              text not null default 'google'
                        check (source in ('google','created_here')),
  synced_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index calendar_events_start_idx on calendar_events (start_at);

-- ─── Checklists ──────────────────────────────────────────────────────────
create table checklist_templates (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  domain_id           uuid references stewardship_domains(id) on delete set null,
  description         text,
  items               jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

create table checklist_instances (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid references checklist_templates(id) on delete set null,
  name                text not null,
  linked_to_type      text check (linked_to_type in ('project','event','standalone')),
  linked_to_id        uuid,
  items               jsonb not null default '[]'::jsonb,
  due_date            date,
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index checklist_instances_link_idx on checklist_instances (linked_to_type, linked_to_id);

-- ─── Content pipeline ────────────────────────────────────────────────────
create table content_items (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  channel             text not null check (channel in
                        ('jeradwp','hillmedia','fieldnotes','sitenitro','personal','other')),
  type                text not null check (type in
                        ('video','article','short_clip','podcast_episode','newsletter')),
  status              text not null default 'idea' check (status in
                        ('idea','outline','filming','editing','published',
                         'derivatives_pending','done')),
  outline_md          text,
  video_url           text,
  published_at        timestamptz,
  parent_id           uuid references content_items(id) on delete set null,
  derivative_type     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index content_items_channel_status_idx on content_items (channel, status);
create index content_items_parent_idx on content_items (parent_id);

create table content_templates (
  id                  uuid primary key default gen_random_uuid(),
  channel             text not null,
  trigger_status      text not null,
  derivative_type     text not null,
  title_template      text not null,
  default_due_offset_days integer not null default 7,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- ─── Journal, notes, quotes, books ───────────────────────────────────────
create table journal_books (
  id                  uuid primary key default gen_random_uuid(),
  book_number         integer not null unique,
  start_date          date,
  end_date            date,
  notes               text,
  created_at          timestamptz not null default now()
);

create table journal_entries (
  id                  uuid primary key default gen_random_uuid(),
  book_id             uuid references journal_books(id) on delete set null,
  entry_date          date not null,
  image_path          text,
  transcription_text  text,
  source              text not null default 'typed' check (source in
                        ('handwritten_photo','voice','typed')),
  tags                text[] not null default '{}',
  extracted_facts     jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index journal_entries_date_idx on journal_entries (entry_date desc);
create index journal_entries_tags_idx on journal_entries using gin (tags);

create table notes (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null default 'note' check (type in
                        ('note','quote','idea','personal_log')),
  body                text not null,
  tags                text[] not null default '{}',
  related_project_id  uuid references projects(id) on delete set null,
  related_person_id   uuid references people(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index notes_tags_idx on notes using gin (tags);

create table books (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  author              text,
  isbn                text,
  cover_image_url     text,
  status              text not null default 'want_to_read' check (status in
                        ('reading','finished','abandoned','want_to_read')),
  format              text check (format in ('physical','kindle','audiobook')),
  started_at          date,
  finished_at         date,
  rating              integer check (rating between 1 and 5),
  my_summary          text,
  created_at          timestamptz not null default now()
);

create table quotes (
  id                  uuid primary key default gen_random_uuid(),
  book_id             uuid references books(id) on delete set null,
  text                text not null,
  page_number         integer,
  chapter             text,
  source_type         text check (source_type in
                        ('book','article','podcast','conversation','other')),
  source_ref          text,
  source_author       text,
  tags                text[] not null default '{}',
  my_notes            text,
  added_via           text not null default 'manual' check (added_via in
                        ('voice','readwise_import','manual','journal_extraction')),
  last_surfaced_at    timestamptz,
  created_at          timestamptz not null default now()
);
create index quotes_tags_idx on quotes using gin (tags);
create index quotes_last_surfaced_idx on quotes (last_surfaced_at nulls first);

-- ─── Inventory ───────────────────────────────────────────────────────────
create table inventory_categories (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique,
  default_depreciation_rate numeric(5,4),
  insurance_relevant  boolean not null default true,
  created_at          timestamptz not null default now()
);

create table inventory_items (
  id                  uuid primary key default gen_random_uuid(),
  category            text not null,
  brand               text,
  model               text,
  serial_number       text,
  purchase_date       date,
  purchase_price      numeric(12,2),
  purchase_source     text,
  current_value_estimate numeric(12,2),
  value_updated_at    timestamptz,
  status              text not null default 'owned' check (status in
                        ('owned','sold','lost','damaged','loaned')),
  sold_date           date,
  sold_price          numeric(12,2),
  sold_to             text,
  photos              jsonb not null default '[]'::jsonb,
  receipts            jsonb not null default '[]'::jsonb,
  location            text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index inventory_items_category_idx on inventory_items (category);
create index inventory_items_status_idx   on inventory_items (status);

-- ─── Notifications, observations, action log ────────────────────────────
create table notifications (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null,
  title               text not null,
  body                text,
  source_ref          text,
  source_url          text,
  status              text not null default 'unread' check (status in
                        ('unread','read','dismissed')),
  undo_payload        jsonb,
  created_at          timestamptz not null default now()
);
create index notifications_status_idx on notifications (status, created_at desc);

create table observations (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null,
  severity            text not null default 'info' check (severity in
                        ('info','notable','concerning')),
  title               text not null,
  body                text,
  supporting_data     jsonb not null default '{}'::jsonb,
  domain_id           uuid references stewardship_domains(id) on delete set null,
  project_id          uuid references projects(id) on delete set null,
  surfaced_at         timestamptz not null default now(),
  dismissed_at        timestamptz,
  acted_on            boolean not null default false
);
create index observations_surfaced_idx on observations (surfaced_at desc)
  where dismissed_at is null;

create table action_log (
  id                  uuid primary key default gen_random_uuid(),
  action_type         text not null,
  target_system       text not null check (target_system in
                        ('drive','gmail','calendar','internal','anthropic')),
  description         text not null,
  payload             jsonb not null default '{}'::jsonb,
  status              text not null default 'success' check (status in
                        ('success','failed','pending','undone')),
  triggered_by        text not null,
  executed_at         timestamptz not null default now()
);
create index action_log_executed_idx on action_log (executed_at desc);

create table email_rules (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  match_criteria      jsonb not null default '{}'::jsonb,
  action_type         text not null check (action_type in
                        ('move_attachments_to_drive','create_task',
                         'notify_only','extract_to_inbox','tag')),
  action_params       jsonb not null default '{}'::jsonb,
  confidence_state    text not null default 'draft' check (confidence_state in
                        ('draft','learning','auto')),
  confirmation_count  integer not null default 0,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

create table resurfacing_seen (
  id                  uuid primary key default gen_random_uuid(),
  item_type           text not null check (item_type in
                        ('journal','quote','verse','win','note','project_milestone')),
  item_id             uuid not null,
  surfaced_on         date not null default current_date,
  user_response       text check (user_response in ('viewed','dismissed','saved'))
);
create unique index resurfacing_seen_uniq on resurfacing_seen (item_type, item_id, surfaced_on);

-- ─── Generic ingestion ───────────────────────────────────────────────────
create table captured_data (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null check (source in
                        ('zapier','cowork','n8n','manual','webhook','smart_glasses','other')),
  type                text not null,
  payload             jsonb not null default '{}'::jsonb,
  tags                text[] not null default '{}',
  display_hint        text not null default 'log' check (display_hint in
                        ('card','log','hidden')),
  processed_status    text not null default 'raw' check (processed_status in
                        ('raw','parsed','displayed','archived')),
  source_ref          text,
  created_at          timestamptz not null default now()
);
create index captured_data_type_idx on captured_data (type, created_at desc);
create index captured_data_tags_idx on captured_data using gin (tags);

-- ─── Auto-updating updated_at trigger ────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'stewardship_domains','people','projects','tasks','calendar_events',
      'content_items','inventory_items'
    ])
  loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
       for each row execute function set_updated_at()',
      t, t
    );
  end loop;
end $$;
