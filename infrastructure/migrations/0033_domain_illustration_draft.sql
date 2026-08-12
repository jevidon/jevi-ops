-- Migration 0033: candidate slot for domain illustrations.
--
-- Redrawing a domain's board illustration no longer overwrites the saved
-- art. A fresh render lands here instead; the settings page shows it as
-- a Candidate beside the Current drawing with explicit Keep / Discard.
-- Keep copies draft → illustration and clears the draft; Discard just
-- clears it. Same shape as the illustration column (migration 0032):
-- { svg, style, source, generated_at }.
--
-- Written only by the API (POST /api/domains/:id/illustration/draft and
-- the commit/discard endpoints); intentionally absent from
-- UpdateDomainSchema so clients can never supply raw SVG.

alter table stewardship_domains
  add column if not exists illustration_draft jsonb;

comment on column stewardship_domains.illustration_draft is
  'Candidate illustration awaiting Keep/Discard on the domain settings page. Same shape as illustration; null = no pending candidate.';
