-- Resumable owner onboarding. Upgraded installations with an owner stay opt-in.
create table if not exists onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth_user(id),
  creation_key text not null,
  creation_fingerprint text not null,
  module_id text not null,
  module_version integer not null,
  subject_id uuid references assets(id),
  parent_session_id uuid references onboarding_sessions(id),
  status text not null default 'in_progress',
  current_step_id text not null,
  step_states jsonb not null default '{}',
  draft jsonb not null default '{}',
  revision integer not null default 0,
  preview jsonb,
  commit_operation_key text,
  commit_receipt jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint onboarding_sessions_module check (module_id in ('core', 'vehicle')),
  constraint onboarding_sessions_status check (status in ('in_progress', 'deferred', 'completed', 'abandoned')),
  constraint onboarding_sessions_revision check (revision >= 0 and module_version > 0),
  constraint onboarding_sessions_completed_receipt check ((status = 'completed') = (commit_receipt is not null and commit_operation_key is not null and completed_at is not null))
);
create unique index if not exists onboarding_sessions_creation_key on onboarding_sessions(owner_id, creation_key);
create unique index if not exists onboarding_sessions_active_subject on onboarding_sessions(module_id, subject_id) where subject_id is not null and status in ('in_progress', 'deferred');
create unique index if not exists onboarding_sessions_active_core on onboarding_sessions(owner_id, module_id) where module_id = 'core' and status in ('in_progress', 'deferred');
create unique index if not exists onboarding_sessions_commit_key on onboarding_sessions(owner_id, commit_operation_key) where commit_operation_key is not null;
create index if not exists onboarding_sessions_owner_updated on onboarding_sessions(owner_id, updated_at);

create table if not exists installation_setup (
  id boolean primary key default true,
  state text not null default 'eligible',
  core_session_id uuid references onboarding_sessions(id),
  updated_at timestamptz not null default now(),
  constraint installation_setup_singleton check (id),
  constraint installation_setup_state check (state in ('eligible', 'opt_in', 'in_progress', 'deferred', 'completed'))
);
insert into installation_setup (id, state)
values (true, case when exists (select 1 from auth_user) then 'opt_in' else 'eligible' end)
on conflict (id) do nothing;

create table if not exists onboarding_operation_receipts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references onboarding_sessions(id),
  action_id text not null,
  operation_key text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now()
);
create unique index if not exists onboarding_operations_key on onboarding_operation_receipts(session_id, operation_key);
