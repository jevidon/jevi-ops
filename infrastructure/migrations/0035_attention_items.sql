-- Migration 0035: the Attention Engine's item store.
-- Ported from upstream jerad-ops 0035 (v2.0.0, Addendum 05 §10), minus RLS
-- (single-tenant fork — the app is the trust boundary) and with score as
-- real (this fork's convention for non-monetary floats).
--
-- A daily rule engine (apps/api/src/lib/attention.ts) evaluates time- and
-- inactivity-triggered rules across people/domains/projects/tasks/content
-- and writes attention_items — the "what needs my attention right now?"
-- surface. Each item has a score → urgency, a snooze/dismiss/acted
-- lifecycle, and a stable dedup_key so the same situation doesn't pile up
-- duplicates. source_type keeps upstream's full vocabulary (company/
-- conversation included) so a future CRM port needs no schema change.

create table if not exists attention_items (
  id uuid primary key default gen_random_uuid(),

  -- Which rule produced it + what it points at.
  rule_type text not null,
  source_type text not null check (source_type in
    ('person','company','domain','project','conversation','task','content')),
  source_id uuid not null,

  -- Display.
  title text not null,
  detail text,
  suggested_action text,

  -- Prioritization. Higher score = more urgent; urgency is derived at
  -- generation time (high >= 80, normal 30-79, low < 30).
  score real not null default 0,
  urgency text not null check (urgency in ('low','normal','high')),

  -- Lifecycle.
  first_surfaced_at timestamptz not null default now(),
  last_surfaced_at timestamptz not null default now(),
  surface_count integer not null default 1,
  status text not null default 'active' check (status in
    ('active','dismissed','snoozed','acted_on','expired')),
  snoozed_until date,
  dismissed_at timestamptz,
  acted_on_at timestamptz,
  acted_on_action text,

  -- Stable key per (rule, source, time-bucket) — prevents duplicates and
  -- lets dismiss/snooze scope to "this occurrence". UNIQUE so re-runs
  -- upsert rather than duplicate.
  dedup_key text not null unique,

  created_at timestamptz not null default now()
);

create index if not exists idx_attention_active
  on attention_items(status, score desc) where status = 'active';
create index if not exists idx_attention_snoozed
  on attention_items(status, snoozed_until) where status = 'snoozed';
create index if not exists idx_attention_source
  on attention_items(source_type, source_id);

comment on table attention_items is
  'Attention Engine surfacing items. Regenerated daily by the attention cron.';
comment on column attention_items.dedup_key is
  'Stable {rule_type}:{entity_id}:{time_bucket} key. UNIQUE — re-runs update rather than duplicate.';
