-- Migration 0045: one-time shopping items.
--
-- Not everything on a shopping list is a staple. A party's balloons or a
-- recipe's one-off ingredient should be bought once and leave the list,
-- not cycle back to "stocked" forever. one_off=true items archive
-- themselves on purchase (ledger row still written first) and on
-- dismiss; undoing the purchase un-archives and re-flags.
--
-- one_off and recurrence_rule are mutually exclusive — a one-time item
-- has no cadence by definition. Enforced by CHECK, mirrored app-side.

alter table shopping_items
  add column if not exists one_off boolean not null default false;

alter table shopping_items
  drop constraint if exists shopping_items_one_off_no_recurrence;
alter table shopping_items
  add constraint shopping_items_one_off_no_recurrence
    check (not (one_off and recurrence_rule is not null));

comment on column shopping_items.one_off is
  'One-time item: archives itself on purchase (after the ledger row) or dismiss, instead of cycling back to stocked. Mutually exclusive with recurrence_rule.';
