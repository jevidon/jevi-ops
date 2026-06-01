-- Migration 0024: personal health record.
--
-- New top-level area at /health. Sibling to /library, /content, etc.
--
-- Design decisions (see conversation history for the full reasoning):
--
--   • health_metrics is a flexible (date, metric, value) table that
--     handles vitals + wearable data uniformly. Adding a new metric
--     type later = new enum-like text value, no schema change.
--   • Every metric row carries a source ('manual', 'garmin', etc.) AND
--     an optional visit_id, so we know not just where the data came
--     from but the clinical context if any.
--   • Labs are two tables: lab_panels (one row per panel drawn) and
--     lab_results (one row per analyte within the panel). Trend views
--     query lab_results grouped by analyte across panels.
--   • Workouts get their own table — event-shaped, lots of context
--     fields specific to activities, doesn't flatten cleanly into
--     health_metrics.
--   • wellbeing_check_ins are structured (mood/energy/sleep/pain 1-5
--     or 0-10) plus free-text. Feeds the future "how am I doing" Claude
--     summary feature.
--   • medications has a `kind` enum covering prescription / supplement
--     / vitamin / OTC so the same table holds everything you ingest.
--   • health_documents stores Supabase Storage paths (NOT Bunny —
--     medical docs deserve auth-gated access, not public CDN URLs).
--   • health_history is the singleton narrative-plus-structured-arrays
--     pattern (same trick as app_settings) for past medical history.

-- ─── Visits ──────────────────────────────────────────────────────────────
-- Created first so health_metrics + lab_panels + health_documents can FK to it.

create table if not exists health_visits (
  id                  uuid primary key default gen_random_uuid(),
  visit_date          date not null,
  provider_name       text,
  provider_specialty  text,
  visit_type          text check (visit_type in (
                        'annual', 'sick', 'specialist', 'follow_up',
                        'lab', 'imaging', 'urgent_care', 'emergency',
                        'telehealth', 'other'
                      )),
  reason              text,
  assessment          text,
  plan                text,
  notes               text,
  follow_up_date      date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists health_visits_date_idx
  on health_visits (visit_date desc);

-- ─── Vitals + wearable metrics ───────────────────────────────────────────
-- One table, many metric types. Every row knows where it came from.

create table if not exists health_metrics (
  id              uuid primary key default gen_random_uuid(),
  measured_at     timestamptz not null,
  metric          text not null,            -- 'weight' | 'bp' | 'hr_resting' | 'sleep_duration' | …
  value           numeric,                  -- primary numeric value
  value_secondary numeric,                  -- for BP-shaped readings (diastolic)
  unit            text,                     -- 'kg' | 'mmHg' | 'bpm' | 'min' | 'ms' | …
  source          text not null default 'manual' check (source in (
                    'manual', 'garmin', 'apple_health', 'google_health',
                    'whoop', 'oura', 'other'
                  )),
  visit_id        uuid references health_visits(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists health_metrics_metric_date_idx
  on health_metrics (metric, measured_at desc);
create index if not exists health_metrics_source_idx
  on health_metrics (source);
create index if not exists health_metrics_visit_idx
  on health_metrics (visit_id) where visit_id is not null;

-- ─── Labs ────────────────────────────────────────────────────────────────

create table if not exists lab_panels (
  id                 uuid primary key default gen_random_uuid(),
  drawn_date         date not null,
  panel_name         text not null,         -- 'CBC', 'CMP', 'Lipid', 'HbA1c standalone', …
  ordering_provider  text,
  lab_facility       text,                  -- 'Quest', 'LabCorp', specific hospital lab
  notes              text,
  visit_id           uuid references health_visits(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists lab_panels_drawn_date_idx
  on lab_panels (drawn_date desc);
create index if not exists lab_panels_visit_idx
  on lab_panels (visit_id) where visit_id is not null;

create table if not exists lab_results (
  id                    uuid primary key default gen_random_uuid(),
  panel_id              uuid not null references lab_panels(id) on delete cascade,
  analyte               text not null,      -- 'HbA1c' | 'LDL' | 'TSH' | 'Vitamin D' | …
  value                 numeric,
  value_text            text,               -- for non-numeric results ('positive', 'negative')
  unit                  text,
  reference_range_low   numeric,
  reference_range_high  numeric,
  reference_text        text,               -- raw reference range as printed on the report
  flag                  text check (flag in (
                          'low', 'high', 'critical_low', 'critical_high', 'abnormal'
                        )),
  notes                 text,
  created_at            timestamptz not null default now()
);

create index if not exists lab_results_panel_idx
  on lab_results (panel_id);
-- Critical for the trend-by-analyte view: "show me HbA1c across all panels"
create index if not exists lab_results_analyte_idx
  on lab_results (analyte);

-- ─── Wellbeing check-ins ─────────────────────────────────────────────────
-- Structured ratings (1-5 scale, 0-10 for pain) + optional free-text.
-- Feeds the future health-summary Claude prompt.

create table if not exists wellbeing_check_ins (
  id             uuid primary key default gen_random_uuid(),
  checked_in_at  timestamptz not null default now(),
  mood           smallint check (mood between 1 and 5),
  energy         smallint check (energy between 1 and 5),
  sleep_quality  smallint check (sleep_quality between 1 and 5),
  pain           smallint check (pain between 0 and 10),
  notes          text,
  created_at     timestamptz not null default now()
);

create index if not exists wellbeing_check_ins_date_idx
  on wellbeing_check_ins (checked_in_at desc);

-- ─── Medications + supplements + vitamins ────────────────────────────────
-- Same table, kind enum distinguishes them.

create table if not exists medications (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  kind                  text not null default 'prescription' check (kind in (
                          'prescription', 'supplement', 'vitamin', 'otc'
                        )),
  dosage                text,                -- '10mg', '500 IU', '1 tab', etc.
  frequency             text,                -- 'daily', 'twice daily', 'as needed', …
  prescribing_provider  text,                -- null for OTC / supplements / vitamins
  reason                text,                -- what it's for
  start_date            date,
  stop_date             date,
  active                boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists medications_active_kind_idx
  on medications (kind, active) where active = true;

-- ─── Documents (Supabase Storage backed) ─────────────────────────────────
-- The bytes live in a private Supabase Storage bucket called 'health-documents'
-- (user creates this in the dashboard before first upload). We only store
-- the path + metadata here; signed URLs are minted per-view by the API.

create table if not exists health_documents (
  id              uuid primary key default gen_random_uuid(),
  storage_path    text not null,            -- path within the Supabase Storage bucket
  filename        text not null,
  mime_type       text not null,
  size_bytes      bigint,
  document_type   text check (document_type in (
                    'lab_report', 'imaging_report', 'visit_summary',
                    'discharge_summary', 'prescription', 'vaccination_record',
                    'insurance', 'other'
                  )),
  document_date   date,                     -- date on the document (not upload time)
  visit_id        uuid references health_visits(id) on delete set null,
  panel_id        uuid references lab_panels(id) on delete set null,
  notes           text,
  -- OCR fields wired now even though the parsing flow ships in Session 2.
  -- Lets us upload + view docs without losing the metadata when OCR lands.
  ocr_status      text check (ocr_status in ('pending', 'parsed', 'reviewed', 'skipped')),
  ocr_extracted   jsonb,
  uploaded_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists health_documents_visit_idx
  on health_documents (visit_id) where visit_id is not null;
create index if not exists health_documents_panel_idx
  on health_documents (panel_id) where panel_id is not null;
create index if not exists health_documents_uploaded_idx
  on health_documents (uploaded_at desc);

-- ─── Workouts ────────────────────────────────────────────────────────────
-- Event-shaped (one row per workout). Not flattened into health_metrics
-- because each workout has too much specific context.

create table if not exists workouts (
  id                uuid primary key default gen_random_uuid(),
  started_at        timestamptz not null,
  ended_at          timestamptz,
  duration_min      numeric,
  activity_type     text,                   -- 'run' | 'cycle' | 'walk' | 'strength' | …
  distance_m        numeric,
  avg_hr            smallint,
  max_hr            smallint,
  calories          integer,
  elevation_gain_m  numeric,
  pace_sec_per_km   numeric,                -- for distance-based activities
  power_avg_watts   numeric,                -- cycling
  source            text not null default 'manual' check (source in (
                      'manual', 'garmin', 'apple_health', 'google_health',
                      'whoop', 'strava', 'other'
                    )),
  notes             text,
  created_at        timestamptz not null default now()
);

create index if not exists workouts_started_at_idx
  on workouts (started_at desc);
create index if not exists workouts_activity_type_idx
  on workouts (activity_type, started_at desc);

-- ─── History (narrative + structured) ────────────────────────────────────
-- Singleton row — same pattern as app_settings. Boolean PK pinned to TRUE
-- with a CHECK so we can never accidentally insert a second row.

create table if not exists health_history (
  id              boolean primary key default true,
  narrative       text,                     -- free-text "the story so far"
  conditions      jsonb not null default '[]'::jsonb,  -- [{ name, diagnosed_date, status, notes }]
  surgeries       jsonb not null default '[]'::jsonb,  -- [{ procedure, date, hospital, notes }]
  allergies       jsonb not null default '[]'::jsonb,  -- [{ allergen, reaction, severity, notes }]
  immunizations   jsonb not null default '[]'::jsonb,  -- [{ vaccine, date, notes }]
  family_history  jsonb not null default '[]'::jsonb,  -- [{ relation, condition, notes }]
  updated_at      timestamptz not null default now(),
  constraint health_history_singleton check (id)
);

insert into health_history (id) values (true) on conflict (id) do nothing;

-- ─── Triggers + RLS ──────────────────────────────────────────────────────
-- Reuse the set_updated_at() function created in 0001.

do $$
declare t text;
begin
  for t in select unnest(array[
    'health_visits', 'health_metrics', 'lab_panels',
    'medications', 'health_documents', 'health_history'
  ]) loop
    if not exists (
      select 1 from pg_trigger where tgname = t || '_set_updated_at'
    ) then
      execute format(
        'create trigger %I before update on %I for each row execute function set_updated_at()',
        t || '_set_updated_at', t
      );
    end if;
  end loop;
end $$;

-- RLS: authenticated-only, mirroring every other user-owned table in
-- this single-user app.
do $$
declare t text;
begin
  for t in select unnest(array[
    'health_visits', 'health_metrics', 'lab_panels', 'lab_results',
    'wellbeing_check_ins', 'medications', 'health_documents',
    'workouts', 'health_history'
  ]) loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_authenticated_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t
    );
  end loop;
end $$;

-- ─── Comments ────────────────────────────────────────────────────────────

comment on table health_metrics is
  'Flexible vitals + wearable data. One row per (date, metric, source). Adding new metrics never requires a schema change.';
comment on column health_metrics.source is
  'Where the data originated. Set at import / entry time, never changed.';
comment on column health_metrics.visit_id is
  'If this reading was taken at a clinical visit, link to it. Otherwise NULL.';
comment on table lab_panels is
  'One panel per draw event (e.g., the CBC + CMP from your May 23 annual). Individual analytes live in lab_results.';
comment on table lab_results is
  'Each analyte from a panel (HbA1c, LDL, TSH, …) with its value + the per-result reference range printed on the report.';
comment on table wellbeing_check_ins is
  'Structured + free-text wellbeing log. Feeds the future health-summary feature.';
comment on table medications is
  'Prescriptions, supplements, vitamins, OTC — all in one table, distinguished by kind. Inactive entries kept for history.';
comment on table health_documents is
  'Metadata only — bytes live in a private Supabase Storage bucket. Access via signed URLs minted per-view.';
comment on table health_history is
  'Singleton narrative + structured arrays for past medical history. Single user, single row.';
