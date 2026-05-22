-- OAuth tokens for Google APIs. Single-user system, so a single row.
-- Service-role only — no RLS policies for the authenticated role means
-- regular sessions can't touch this table; only the API (using its service
-- role key) can read/write. Tokens never reach the browser.

create table google_oauth_tokens (
  id                  uuid primary key default gen_random_uuid(),
  -- Plain text storage. RLS denies all user access; service-role bypass is
  -- the only path. If we ever expose this to user RLS, switch to pgsodium.
  access_token        text not null,
  refresh_token       text,
  -- When the access_token expires. We refresh ~1 minute before this.
  expires_at          timestamptz not null,
  scope               text not null,
  token_type          text not null default 'Bearer',
  -- Last time we successfully pulled events from Google.
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Bookkeeping trigger
create trigger google_oauth_tokens_set_updated_at
  before update on google_oauth_tokens
  for each row execute function set_updated_at();

-- RLS on; no policies → only service role can access.
alter table google_oauth_tokens enable row level security;

-- A small comment so the table's purpose is obvious to future-me.
comment on table google_oauth_tokens is
  'Google OAuth tokens for the single user. Service-role only — never exposed via RLS.';
