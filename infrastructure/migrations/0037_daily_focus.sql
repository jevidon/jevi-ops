-- Migration 0037: Tomorrow's Focus.
-- Ported from upstream jerad-ops 0044 §2 (v2.0.0, Addendum 09), minus RLS
-- (single-tenant fork — the app is the trust boundary).
--
-- The one piece of upstream's retired Daily Rule that survives, transformed:
-- one optional pointer per day at a project or content item. Deliberately
-- minimal. There is NO status column and NO completion column: the focus is
-- a POINTER, and the target object's real state already lives on the Work
-- page. Nothing in the system may ever count, score, rate, or display
-- adherence to it.
--
-- One row per date (upsert on the date PK — setting a focus twice for the
-- same day replaces it). target_id is intentionally NOT a foreign key: it
-- points at one of two different tables depending on target_type, which no
-- single FK can express. The app layer validates it against the typed table
-- on write, and reads tolerate a vanished target by rendering nothing.

create table if not exists daily_focus (
  date date primary key,
  target_type text not null check (target_type in ('project','content_item')),
  target_id uuid not null,
  note text,
  created_at timestamptz not null default now()
);

comment on table daily_focus is
  'Tomorrow''s Focus — one optional pointer per day at a project or content item. No status, no completion, no adherence tracking anywhere, permanently.';
comment on column daily_focus.target_type is
  'Which table target_id refers to: project or content_item. Validated app-side (no FK can span two tables).';
