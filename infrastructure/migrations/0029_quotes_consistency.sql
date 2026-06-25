-- Migration 0029: quotes table consistency fixes.
--
-- Two bugs the cmd-J quote capture surfaced:
--
-- 1. Column name mismatch. The notes table has `source_reference` (added
--    in migration 0006), but the quotes table still has the original
--    `source_ref`. The parser and the executor were written assuming the
--    notes naming, so the executor's insert into quotes failed with
--    "column source_reference does not exist." Rename so the codebase
--    has one name for the same concept.
--
-- 2. CHECK constraint missed 'sermon'. The parser's create_quote prompt
--    lists source_type ∈ {book, article, podcast, conversation, sermon,
--    other}, but the DB constraint only allows the first four and
--    'other'. Quoting a sermon → constraint violation → "1 Failed."

-- ─── 1. Rename source_ref → source_reference ─────────────────────────

alter table quotes rename column source_ref to source_reference;

-- ─── 2. Add 'sermon' to the source_type CHECK constraint ─────────────
-- Constraint name comes from the original CREATE TABLE in 0001; recreate
-- it with the expanded set. IF EXISTS guards a re-run on a fresh DB
-- where this migration is the first to touch the constraint.

alter table quotes drop constraint if exists quotes_source_type_check;
alter table quotes add constraint quotes_source_type_check check (
  source_type in ('book', 'article', 'podcast', 'conversation', 'sermon', 'other')
);
