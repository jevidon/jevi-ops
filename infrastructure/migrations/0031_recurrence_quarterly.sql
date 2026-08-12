-- Migration 0031: add 'quarterly' to the recurrence vocabulary.
--
-- tasks.recurrence_rule is a plain text column (no check constraint) —
-- nothing to change there; the shared RECURRENCE_PATTERNS enum is the
-- source of truth and now includes 'quarterly'.
--
-- project_checklist_items.recurrence_rule DOES have a check constraint
-- (added in 0018), and it had already drifted from the shared enum: it
-- was missing 'semiannually' even though the zod schema accepts it, so
-- saving a semiannual checklist item would pass validation and then be
-- rejected by Postgres. Recreate the constraint with the full current
-- vocabulary: quarterly (new) + semiannually (drift fix).

alter table project_checklist_items
  drop constraint if exists project_checklist_items_recurrence_rule_check;

alter table project_checklist_items
  add constraint project_checklist_items_recurrence_rule_check
  check (recurrence_rule in
    ('daily','weekdays','weekly','biweekly','monthly','quarterly','semiannually','yearly'));

comment on column project_checklist_items.recurrence_rule is
  'Optional recurrence (daily/weekdays/weekly/biweekly/monthly/quarterly/semiannually/yearly). Null = one-shot item.';
