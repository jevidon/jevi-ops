create table if not exists monitoring_policies (
  id uuid primary key default gen_random_uuid(), worker_id uuid not null references research_workers(id), config jsonb not null,
  creation_key text, creation_actor text, creation_fingerprint text,
  revision integer not null default 1, next_due_at timestamptz not null default now(), retry_after_at timestamptz,
  last_swept_at timestamptz, last_attempt_at timestamptz, last_successful_at timestamptz, last_outcome text, last_trigger_fingerprint text, failure_count integer not null default 0,
  actor text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint monitoring_policies_creation_identity unique(creation_actor, creation_key)
);
create table if not exists monitoring_signals (
  id uuid primary key default gen_random_uuid(), policy_id uuid not null references monitoring_policies(id) on delete cascade,
  operation_key text not null, fingerprint text not null, kind text not null, reason text not null, source_id uuid references source_documents(id), actor text not null,
  processed_at timestamptz, created_at timestamptz not null default now(),
  constraint monitoring_signals_operation_identity unique(policy_id, operation_key)
);
create table if not exists monitoring_review_runs (
  id uuid primary key default gen_random_uuid(), policy_id uuid not null references monitoring_policies(id) on delete cascade,
  policy_revision integer not null, trigger_key text not null, reasons jsonb not null, shared_job_id uuid references research_jobs(id), asset_reviews jsonb not null default '[]',
  status text not null default 'researching', created_at timestamptz not null default now(), completed_at timestamptz,
  constraint monitoring_review_runs_trigger_identity unique(policy_id, trigger_key),
  constraint monitoring_review_runs_status_check check(status in ('researching','evaluating','complete','failed','cancelled'))
);
create table if not exists monitoring_notifications (
  id uuid primary key default gen_random_uuid(), policy_id uuid not null references monitoring_policies(id) on delete cascade,
  dedup_key text not null, kind text not null, title text not null, detail text not null, created_at timestamptz not null default now(), read_at timestamptz,
  constraint monitoring_notifications_dedup_identity unique(policy_id, dedup_key)
);
