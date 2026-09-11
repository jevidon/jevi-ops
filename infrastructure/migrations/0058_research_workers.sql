create table if not exists research_workers (
  id uuid primary key default gen_random_uuid(), name text not null, adapter text not null, adapter_version text not null,
  capabilities jsonb not null default '[]', allowed_task_types jsonb not null default '[]', enabled boolean not null default true, configuration_verified boolean not null default false,
  last_seen_at timestamptz, last_health_ok boolean, health_detail text, last_successful_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table api_tokens add column if not exists permission_profile text not null default 'legacy';
alter table api_tokens add column if not exists scopes jsonb not null default '[]';
alter table api_tokens add column if not exists worker_id uuid references research_workers(id);
alter table api_tokens drop constraint if exists api_tokens_permission_profile_check;
alter table api_tokens add constraint api_tokens_permission_profile_check check ((permission_profile = 'legacy' and worker_id is null) or (permission_profile = 'research_worker' and worker_id is not null));
create table if not exists research_jobs (
  id uuid primary key default gen_random_uuid(), schema_version integer not null default 1,
  asset_id uuid not null references assets(id) on delete cascade, requested_worker_id uuid references research_workers(id),
  requester text not null, origin text not null default 'owner', operation_key text not null, fingerprint text not null, request jsonb not null,
  context jsonb not null, context_snapshot text not null, original_metadata jsonb not null, original_doc_version integer not null,
  status text not null default 'requested', attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  worker_id uuid references research_workers(id), run_id uuid, lease_token_hash text, lease_expires_at timestamptz, run_deadline timestamptz,
  failure_reason text, last_checked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint research_jobs_request_key unique(requester, operation_key),
  constraint research_jobs_status_check check(status in ('requested','leased','running','succeeded','failed','cancelled'))
);
create index if not exists research_jobs_pending on research_jobs(status, next_attempt_at);
create table if not exists research_results (
  id uuid primary key default gen_random_uuid(), job_id uuid not null unique references research_jobs(id) on delete cascade,
  worker_id uuid not null references research_workers(id), run_id uuid not null, operation_key text not null, fingerprint text not null,
  result jsonb not null, source_map jsonb not null, receipt jsonb not null, created_at timestamptz not null default now()
);
create table if not exists research_result_sources (
  id uuid primary key default gen_random_uuid(), result_id uuid not null references research_results(id) on delete cascade,
  source_id uuid not null references source_documents(id),
  constraint research_result_sources_identity unique(result_id, source_id)
);
create table if not exists research_proposals (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references research_jobs(id) on delete cascade,
  result_id uuid not null unique references research_results(id) on delete cascade, asset_id uuid not null references assets(id) on delete cascade,
  operations jsonb not null, status text not null default 'pending_review', revision integer not null default 1,
  preview jsonb, fingerprint text, operation_key text, receipt jsonb, actor text, reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint research_proposals_status_check check(status in ('pending_review','applied','rejected','superseded','conflicted'))
);
create table if not exists research_audit (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references research_jobs(id) on delete cascade,
  event text not null, actor text not null, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
