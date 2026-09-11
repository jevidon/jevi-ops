-- Reviewed receipt imports record history without making it today's service
-- baseline. Persist the distinction so later corrections/undo preserve pins.
alter table maintenance_logs add column if not exists historical_only boolean not null default false;
alter table maintenance_logs drop constraint if exists maintenance_logs_history_not_baseline;
alter table maintenance_logs add constraint maintenance_logs_history_not_baseline check (not (historical_only and is_baseline));
