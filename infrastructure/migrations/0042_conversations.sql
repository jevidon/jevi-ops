-- Migration 0042: unified conversations table (CRM module port).
-- Ported from upstream jerad-ops v2.0.0 migration 0034 (RLS stripped;
-- the backfill is rewritten for this fork's leaner person_interactions
-- shape: person_id / interaction_type / notes / occurred_at only).
--
-- Replaces person_interactions with a richer superset that can attach to a
-- company / person / project / task (at least one required), carries a
-- summary, email metadata, and follow-up flags that feed the Attention
-- Engine.
--
-- Decision (user-confirmed): conversations REPLACES person_interactions.
-- Existing rows are backfilled, then every write path repoints to
-- conversations. person_interactions stays in place as a read-only
-- archive (not dropped) — nothing writes to it after this.

-- ─── 1. conversations ──────────────────────────────────────────────────

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),

  -- Associations — at least one must be set (enforced by the CHECK below).
  company_id uuid references companies(id) on delete set null,
  person_id uuid references people(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,

  interaction_type text not null check (interaction_type in (
    'email', 'call', 'text_message', 'social_dm',
    'in_person', 'meeting', 'video_call', 'other'
  )),
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),

  -- Content. summary is always present (user text for manual entries);
  -- body_excerpt is the optional first slice of source material.
  subject text,
  summary text not null,
  body_excerpt text,

  -- Email-specific metadata (unused until an email-capture path exists in
  -- this fork; kept for schema parity so imports round-trip).
  email_message_id text,
  email_thread_id text,
  email_deep_link text,
  from_address text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',

  captured_via text not null default 'manual' check (captured_via in (
    'email_forward', 'manual', 'voice', 'import'
  )),
  requires_followup boolean not null default false,
  followup_by date,

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint conversations_has_association check (
    company_id is not null or person_id is not null
    or project_id is not null or task_id is not null
  )
);

create index if not exists idx_conversations_company on conversations(company_id);
create index if not exists idx_conversations_person on conversations(person_id);
create index if not exists idx_conversations_project on conversations(project_id);
create index if not exists idx_conversations_task on conversations(task_id);
create index if not exists idx_conversations_occurred_at on conversations(occurred_at desc);
create index if not exists idx_conversations_followup
  on conversations(requires_followup, followup_by) where requires_followup = true;
create unique index if not exists idx_conversations_email_message_id
  on conversations(email_message_id) where email_message_id is not null;

-- ─── 2. Auto-stamp last_interaction_at / updated_at on insert ──────────
-- A trigger so EVERY insert path keeps the company's last_interaction_at
-- and the person's updated_at fresh without each caller remembering to.
-- Only advances last_interaction_at forward.

create or replace function conversations_touch_associations() returns trigger as $$
begin
  if new.company_id is not null then
    update companies
       set last_interaction_at = greatest(coalesce(last_interaction_at, new.occurred_at), new.occurred_at)
     where id = new.company_id;
  end if;
  if new.person_id is not null then
    update people set updated_at = now() where id = new.person_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_conversations_touch on conversations;
create trigger trg_conversations_touch
  after insert on conversations
  for each row execute function conversations_touch_associations();

-- ─── 3. Backfill from this fork's person_interactions ──────────────────
--   interaction_type: 'text' → 'text_message', else unchanged (email /
--     call / in_person / meeting / other are valid in both vocabularies).
--   direction: unknown on legacy rows — 'inbound' (matches upstream's
--     backfill default; editable later).
--   summary: NOT NULL, so coalesce notes → a placeholder.
-- Idempotent: skips rows whose person+occurred_at already landed.

insert into conversations (
  person_id, interaction_type, direction, summary, captured_via, occurred_at, created_at
)
select
  pi.person_id,
  case pi.interaction_type when 'text' then 'text_message' else pi.interaction_type end,
  'inbound',
  coalesce(nullif(btrim(pi.notes), ''), 'Logged interaction'),
  'manual',
  pi.occurred_at,
  now()
from person_interactions pi
where not exists (
  select 1 from conversations c
   where c.person_id is not distinct from pi.person_id
     and c.occurred_at = pi.occurred_at
     and c.captured_via = 'manual'
);

-- ─── 4. Comments ───────────────────────────────────────────────────────

comment on table conversations is
  'Unified interaction log (CRM port). Supersedes person_interactions, which is now a read-only archive.';
comment on column conversations.summary is
  'User-provided (manual/voice) or import-generated. Always present — shown in timelines.';
comment on constraint conversations_has_association on conversations is
  'A conversation must relate to at least one of company/person/project/task.';
