-- 0055_drop_shopping_module.sql
-- Decommission the deprecated shopping module.
--
-- Background: shopping_lists / shopping_items / shopping_purchases came from
-- PR #21 (feat/shopping-module, closed, never merged), so no earlier tracked
-- migration creates them. They were unused: no API route and no web UI served
-- them at time of removal. The Shopping project's tasks are the sole source of
-- truth for shopping; items that existed only here were explicitly discarded
-- by the owner, along with all archived rows.
--
-- Dependent objects (FKs, indexes, CHECK constraints, updated_at triggers) are
-- owned by the tables and drop with them. No views or functions reference the
-- module, and no other table has an FK into it.

drop table if exists shopping_purchases cascade;
drop table if exists shopping_items cascade;
drop table if exists shopping_lists cascade;
