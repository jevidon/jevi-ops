-- Original evidence is private and independent from the public photo gallery.
create table if not exists source_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('file', 'text', 'link')),
  content_hash text not null unique,
  media_type text not null,
  size_bytes integer not null check (size_bytes >= 0),
  storage_key text,
  text_content text,
  source_url text,
  created_at timestamptz not null default now(),
  check ((kind = 'file' and storage_key is not null and text_content is null)
      or (kind = 'text' and text_content is not null and storage_key is null)
      or (kind = 'link' and source_url is not null and storage_key is null))
);
create table if not exists source_links (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source_documents(id),
  asset_id uuid references assets(id) on delete cascade,
  session_id uuid references onboarding_sessions(id) on delete cascade,
  label text not null,
  actor text not null,
  created_at timestamptz not null default now(),
  check ((asset_id is not null)::int + (session_id is not null)::int = 1)
);
create unique index if not exists idx_source_links_asset on source_links(source_id, asset_id) where asset_id is not null;
create unique index if not exists idx_source_links_session on source_links(source_id, session_id) where session_id is not null;
create table if not exists source_candidates (
  id uuid primary key default gen_random_uuid(),
  source_link_id uuid not null references source_links(id),
  operation_key text not null,
  creation_fingerprint text not null,
  candidate jsonb not null,
  revision integer not null default 1 check (revision > 0),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  receipt jsonb,
  accepted_key text,
  accepted_fingerprint text,
  actor text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_link_id, operation_key)
);
