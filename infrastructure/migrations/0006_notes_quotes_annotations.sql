-- Spec Addendum 02 — Notes & Quote Annotations.
-- Replaces the parent spec's notes/quotes model so:
--   - thoughts ABOUT a quote stay attached as their own dated records
--     (one-to-many) instead of clobbering a single my_notes blob
--   - free notes get a finer-grained source_type than the old 4-value enum
--   - voice captures from mobile shortcuts that the parser can't route
--     confidently land as needs_review=true notes for later re-classification

-- ─── notes ──────────────────────────────────────────────────────────────

-- Drop the old type-based CHECK constraint and column. The Library UI
-- isn't built yet, so no UI breaks; any test rows lose their `type`.
alter table notes drop constraint if exists notes_type_check;
alter table notes drop column if exists type;

-- New source_type enum (CHECK) — wider than the old 4-value enum and
-- focused on the *context of capture*, not the structural kind.
alter table notes
  add column if not exists source_type text not null default 'own_thought'
    check (source_type in (
      'own_thought', 'reading_response', 'meeting_note',
      'brainstorm', 'observation', 'other'
    ));

-- Optional free-text reference for non-DB sources (article title, URL,
-- sermon title, etc.). Use related_quote_id when the source IS a
-- captured quote.
alter table notes
  add column if not exists source_reference text,
  add column if not exists related_quote_id uuid references quotes(id) on delete set null,
  -- Mobile capture lands here when routing is ambiguous (Addendum 02 §4).
  -- Surfaced on Today for one-tap re-classification (Addendum 01).
  add column if not exists needs_review boolean not null default false;

create index if not exists notes_source_type_idx on notes (source_type);
create index if not exists notes_needs_review_idx on notes (needs_review) where needs_review;
create index if not exists notes_related_quote_idx on notes (related_quote_id)
  where related_quote_id is not null;

-- ─── quotes ─────────────────────────────────────────────────────────────

-- Remove my_notes — replaced by the quote_annotations table.
alter table quotes drop column if exists my_notes;

-- ─── quote_annotations ─────────────────────────────────────────────────

create table if not exists quote_annotations (
  id              uuid primary key default gen_random_uuid(),
  quote_id        uuid not null references quotes(id) on delete cascade,
  body            text not null,
  -- annotated_at is when the user added this annotation. Distinct from
  -- created_at — both are usually equal, but a future bulk import (e.g.
  -- Kindle highlights with backdated thoughts) wants annotated_at to
  -- preserve the original timeline.
  annotated_at    timestamptz not null default now(),
  context         text check (context in (
    'on_capture',   -- bundled with the original quote save
    'on_revisit',   -- user came back to the quote later
    'on_surface',   -- added when the resurfacing engine surfaced this
    'unspecified'
  )) default 'unspecified',
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists quote_annotations_quote_idx on quote_annotations (quote_id, annotated_at desc);
create index if not exists quote_annotations_tags_idx  on quote_annotations using gin (tags);

-- Auto-update updated_at on row updates.
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'quote_annotations_set_updated_at'
  ) then
    create trigger quote_annotations_set_updated_at
      before update on quote_annotations
      for each row execute function set_updated_at();
  end if;
end $$;

-- RLS — single-user system, authenticated-only policy matches the rest
-- of the schema (see 0003_rls.sql).
alter table quote_annotations enable row level security;
drop policy if exists quote_annotations_authenticated_all on quote_annotations;
create policy quote_annotations_authenticated_all on quote_annotations
  for all
  to authenticated
  using (true)
  with check (true);

comment on table quote_annotations is
  'One-to-many thoughts attached to a quote. Each annotation is a dated record so the user accumulates a thinking history per quote over time.';
