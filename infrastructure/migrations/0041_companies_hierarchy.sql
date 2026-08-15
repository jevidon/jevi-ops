-- Migration 0041: companies + contact hierarchy (CRM module port).
-- Ported from upstream jerad-ops v2.0.0 migration 0033 (RLS stripped —
-- this fork authenticates at the API, not the row).
--
-- Turns the single-person people list into a client-operations model: a
-- companies table, a company link + promoted date fields on people, a
-- company link on projects, and a project_contacts join table.
--
-- Reconciliations (inherited from upstream, still true here):
--   * people has a freeform `company` TEXT column. We backfill it into
--     companies + set company_id, but KEEP the text column as a nullable
--     legacy fallback. A hard drop could silently lose names that don't
--     map cleanly.
--   * projects has `client_id` (FK people) meaning "the contact". The CRM
--     model's primary_contact_id is the same concept — RENAME rather than
--     add a second overlapping person FK.
--   * birthday/anniversary exist as person_facts rows. Backfill into the
--     new promoted columns (the Attention Engine queries columns) and
--     leave the facts intact — no history lost.

-- ─── 1. companies ──────────────────────────────────────────────────────

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain_id uuid references stewardship_domains(id) on delete set null,
  relationship_type text check (relationship_type in (
    'active_client', 'past_client', 'prospect',
    'vendor', 'partner', 'brand_deal', 'other'
  )),
  website text,
  primary_email text,
  primary_phone text,
  notes text,
  first_engagement_at date,
  -- Stamped from conversations.occurred_at by trigger (0042). Powers the
  -- Attention Engine's company_silent rule.
  last_interaction_at timestamptz,
  next_review_at date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_companies_domain on companies(domain_id);
create index if not exists idx_companies_active on companies(active) where active = true;
create index if not exists idx_companies_last_interaction
  on companies(last_interaction_at desc nulls last);
create unique index if not exists idx_companies_name_lower on companies(lower(name));

drop trigger if exists trg_companies_updated_at on companies;
create trigger trg_companies_updated_at
  before update on companies
  for each row execute function set_updated_at();

-- ─── 2. people: company link + promoted date fields ────────────────────

alter table people
  add column if not exists company_id uuid references companies(id) on delete set null,
  add column if not exists role_at_company text,
  add column if not exists is_primary_contact boolean not null default false,
  add column if not exists birthday date,
  add column if not exists anniversary date;

create index if not exists idx_people_company on people(company_id);
-- One primary contact per company (partial unique). Rows with company_id NULL
-- or is_primary_contact false are exempt.
create unique index if not exists idx_people_one_primary_per_company
  on people(company_id) where is_primary_contact = true and company_id is not null;

-- Backfill: distinct freeform company names → companies rows.
insert into companies (name)
select distinct trim(company)
  from people
 where company is not null
   and trim(company) <> ''
on conflict (lower(name)) do nothing;

-- Link people to the company row that matches their freeform text.
update people p
   set company_id = c.id
  from companies c
 where p.company is not null
   and trim(p.company) <> ''
   and lower(trim(p.company)) = lower(c.name)
   and p.company_id is null;

-- Backfill promoted birthday/anniversary from person_facts (leave facts intact).
update people p
   set birthday = f.date_relevant
  from person_facts f
 where f.person_id = p.id
   and f.fact_type = 'birthday'
   and f.date_relevant is not null
   and p.birthday is null;

update people p
   set anniversary = f.date_relevant
  from person_facts f
 where f.person_id = p.id
   and f.fact_type = 'anniversary'
   and f.date_relevant is not null
   and p.anniversary is null;

-- ─── 3. projects: rename client_id → primary_contact_id, add company_id ─

alter table projects rename column client_id to primary_contact_id;

alter table projects
  add column if not exists company_id uuid references companies(id) on delete set null;

create index if not exists idx_projects_company on projects(company_id);

-- ─── 4. project_contacts join table ────────────────────────────────────

create table if not exists project_contacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  unique (project_id, person_id)
);

create index if not exists idx_project_contacts_project on project_contacts(project_id);
create index if not exists idx_project_contacts_person on project_contacts(person_id);

-- ─── 5. Comments ───────────────────────────────────────────────────────

comment on table companies is
  'Client/vendor/partner orgs (CRM port). last_interaction_at is stamped from conversations.';
comment on column people.company_id is
  'FK to companies. Backfilled from the legacy freeform people.company text.';
comment on column people.is_primary_contact is
  'The default person to reach for the company. Partial-unique: one true per company.';
comment on column projects.primary_contact_id is
  'Renamed from client_id. The single primary contact person for the project.';
comment on table project_contacts is
  'Additional project contacts beyond primary_contact_id.';
