-- Versioned responsibility evidence, assessments and owner-approved local changes.
create table if not exists responsibility_rules (
  id uuid primary key default gen_random_uuid(), current_version integer not null default 1,
  creation_key text, creation_actor text, creation_fingerprint text,
  created_at timestamptz not null default now(),
  constraint responsibility_rules_creation_identity unique(creation_actor, creation_key),
  constraint responsibility_rules_version_check check (current_version > 0)
);
create table if not exists responsibility_rule_versions (
  id uuid primary key default gen_random_uuid(), rule_id uuid not null references responsibility_rules(id),
  version integer not null, title text not null, kind text not null, scope jsonb not null default '{}',
  status text not null, source_note text, published_at timestamptz, retrieved_at timestamptz,
  effective_from jsonb, effective_until jsonb, effective_from_at timestamptz, effective_until_at timestamptz,
  reason text not null, actor text not null, created_at timestamptz not null default now(),
  constraint responsibility_rule_versions_identity unique (rule_id, version),
  constraint responsibility_rule_versions_kind_check check (kind in ('user_reminder','service_recommendation','regulatory')),
  constraint responsibility_rule_versions_status_check check (status in ('proposed','accepted','withdrawn')),
  constraint responsibility_rule_versions_version_check check (version > 0)
);
create table if not exists responsibility_rule_sources (
  id uuid primary key default gen_random_uuid(), rule_version_id uuid not null references responsibility_rule_versions(id),
  source_id uuid not null references source_documents(id),
  constraint responsibility_rule_sources_identity unique (rule_version_id, source_id)
);
create table if not exists vehicle_assessments (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null references assets(id) on delete cascade,
  rule_id uuid not null references responsibility_rules(id), rule_version_id uuid not null references responsibility_rule_versions(id),
  revision integer not null default 1, applicability text not null, evidence_basis text not null, review_state text not null,
  relevant_facts jsonb not null default '{}', source_ids jsonb not null default '[]', rationale text not null, actor text not null,
  assessed_at timestamptz not null, last_checked_at timestamptz, review_due_at timestamptz,
  item_id uuid references maintenance_items(id) on delete set null, invalidation_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint vehicle_assessments_asset_rule_identity unique (asset_id, rule_id),
  constraint vehicle_assessments_applicability_check check (applicability in ('unknown','applicable','not_applicable')),
  constraint vehicle_assessments_evidence_basis_check check (evidence_basis in ('user_reported','document_supported','official_source_supported')),
  constraint vehicle_assessments_review_state_check check (review_state in ('unreviewed','accepted','needs_review')),
  constraint vehicle_assessments_revision_check check (revision > 0)
);
create table if not exists vehicle_assessment_history (
  id uuid primary key default gen_random_uuid(), assessment_id uuid not null references vehicle_assessments(id) on delete cascade,
  revision integer not null, snapshot jsonb not null, actor text not null, reason text not null,
  created_at timestamptz not null default now(),
  constraint vehicle_assessment_history_identity unique (assessment_id, revision)
);
create table if not exists knowledge_change_previews (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null references assets(id) on delete cascade,
  operation jsonb not null, fingerprint text not null, preconditions jsonb not null, changes jsonb not null,
  actor text not null, operation_key text, receipt jsonb, created_at timestamptz not null default now(),
  constraint knowledge_change_preview_operation_key unique (actor, operation_key)
);
create table if not exists knowledge_transitions (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null references assets(id) on delete cascade,
  preview_id uuid not null unique references knowledge_change_previews(id), operation jsonb not null, preconditions jsonb not null,
  effective jsonb not null, effective_at timestamptz, status text not null default 'pending', revision integer not null default 1,
  actor text not null, approved_at timestamptz not null default now(), reason text, receipt jsonb, applied_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint knowledge_transitions_status_check check (status in ('pending','applied','needs_review','cancelled','superseded')),
  constraint knowledge_transitions_revision_check check (revision > 0),
  constraint knowledge_transitions_receipt_check check ((status = 'applied') = (receipt is not null and applied_at is not null))
);
create index if not exists knowledge_transitions_due on knowledge_transitions(status, effective_at);
create table if not exists knowledge_transition_history (
  id uuid primary key default gen_random_uuid(), transition_id uuid not null references knowledge_transitions(id) on delete cascade,
  revision integer not null, snapshot jsonb not null, actor text not null, reason text not null,
  created_at timestamptz not null default now(),
  constraint knowledge_transition_history_identity unique (transition_id, revision)
);
