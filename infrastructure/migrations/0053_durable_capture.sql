-- Durable capture (capture program, Gate A). Additive only. Historical
-- captured_data rows are NOT backfilled with receipts or attempts: they stay
-- readable through the legacy projection and are never scheduled for
-- interpretation by this migration.

-- Installation identity for receipts and, later, sync cursors. Generated once
-- for the single-owner data space; server_epoch changes only after a
-- destructive restore that invalidates cursors/receipts.
alter table app_settings add column if not exists capture_async_enabled boolean not null default false;
alter table app_settings add column if not exists data_space_id uuid not null default gen_random_uuid();
alter table app_settings add column if not exists server_epoch integer not null default 1;
alter table app_settings drop constraint if exists app_settings_server_epoch_check;
alter table app_settings add constraint app_settings_server_epoch_check check (server_epoch > 0);

-- capture_client credentials: capture-only scopes. Every existing token is
-- 'legacy' (full access); new profiles are opt-in at minting time.
alter table api_tokens add column if not exists permission_profile text not null default 'legacy';
alter table api_tokens add column if not exists scopes jsonb not null default '[]';
alter table api_tokens drop constraint if exists api_tokens_permission_profile_check;
alter table api_tokens add constraint api_tokens_permission_profile_check check (permission_profile in ('legacy', 'capture_client'));
alter table api_tokens drop constraint if exists api_tokens_scopes_check;
alter table api_tokens add constraint api_tokens_scopes_check check (jsonb_typeof(scopes) = 'array');

-- Operation ledger: one terminal result per (data space, client operation id).
-- Only terminal dispositions are stored; transient failures never insert.
create table if not exists operation_receipts (
  data_space_id uuid not null,
  operation_id uuid not null,
  protocol_version integer not null,
  command text not null,
  actor text not null,
  credential_id uuid references api_tokens(id),
  digest text not null,
  disposition text not null,
  status integer not null,
  result jsonb not null,
  resource_ref text,
  server_epoch integer not null,
  created_at timestamptz not null default now(),
  primary key (data_space_id, operation_id),
  constraint operation_receipts_disposition_check check (disposition in ('applied', 'conflict', 'rejected')),
  constraint operation_receipts_status_check check (status between 200 and 599)
);

-- Receipt/processing sidecar for captured_data. processed_status on the
-- legacy row remains a display field; this is the pipeline authority.
create table if not exists capture_receipts (
  capture_id uuid primary key references captured_data(id) on delete cascade,
  data_space_id uuid not null,
  operation_id uuid not null,
  actor text not null,
  credential_id uuid references api_tokens(id),
  client jsonb not null,
  source_item_id text,
  kind text not null,
  intent text not null default 'capture_only',
  modality text,
  captured_at timestamptz not null,
  time_zone text,
  storage_state text not null default 'complete',
  processing_state text not null default 'queued',
  input_revision integer not null default 1,
  current_attempt_no integer not null default 0,
  error_code text,
  outcome jsonb,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capture_receipts_operation_identity unique (data_space_id, operation_id),
  constraint capture_receipts_kind_check check (kind in ('text', 'audio', 'image')),
  constraint capture_receipts_intent_check check (intent in ('capture_only', 'conversation_turn')),
  constraint capture_receipts_modality_check check (modality is null or modality in ('typed', 'spoken', 'photo')),
  constraint capture_receipts_storage_check check (storage_state in ('complete', 'awaiting_media')),
  constraint capture_receipts_processing_check check (processing_state in (
    'awaiting_media', 'queued', 'preprocessing', 'ready_for_hermes', 'interpreting',
    'needs_review', 'committed', 'retry_wait', 'blocked', 'cancelled'))
);
create index if not exists capture_receipts_pending on capture_receipts(processing_state, created_at);

-- Media reservations. storage_key is server-composed (= attachment_id) and
-- set only once the bytes are verified and durably renamed into place.
create table if not exists capture_media (
  attachment_id uuid primary key,
  capture_id uuid not null references captured_data(id) on delete cascade,
  media_type text not null,
  size_bytes integer not null,
  sha256 text not null,
  storage_key text,
  state text not null default 'reserved',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint capture_media_state_check check (state in ('reserved', 'verified')),
  constraint capture_media_size_check check (size_bytes > 0)
);
create index if not exists capture_media_by_capture on capture_media(capture_id);

-- Interpretation attempts (transitional bridge). Every stage transition is
-- fenced by the attempt token so a superseded attempt can never apply effects.
create table if not exists capture_attempts (
  capture_id uuid not null references captured_data(id) on delete cascade,
  attempt_no integer not null,
  attempt_token_hash text not null,
  operation_id uuid not null,
  stage text not null default 'pending',
  stage_changed_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  plan jsonb,
  effects jsonb,
  error_code text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (capture_id, attempt_no),
  constraint capture_attempts_stage_check check (stage in ('pending', 'transcribing', 'parsing', 'executing', 'recording', 'finished'))
);
