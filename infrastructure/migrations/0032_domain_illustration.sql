-- Migration 0032: persistent generated illustration per domain.
--
-- The Domains pulse board now renders each domain as a card with an
-- engraved spot-art illustration. The drawing is composed by the
-- configured LLM under a locked style contract, sanitized server-side,
-- and stored here so it persists across renders; the settings page's
-- "Redraw" button re-rolls it. Domains without a stored illustration
-- fall back to a deterministic procedural motif (packages/shared/src/
-- illustration.ts), so this column being null is a normal state, not
-- an error.
--
-- Shape: { svg, style, source, generated_at }
--   svg          sanitized inner-SVG markup for the 240x100 canvas
--   style        'engraved' (the only style for now)
--   source       'llm' | 'procedural' (fallback used when a model
--                render fails validation or no model is configured)
--   generated_at ISO timestamp of the render
--
-- Written only by the API (POST /api/domains/:id/illustration); it is
-- intentionally absent from UpdateDomainSchema so clients can never
-- supply raw SVG.

alter table stewardship_domains
  add column if not exists illustration jsonb;

comment on column stewardship_domains.illustration is
  'Server-generated engraved spot art for the Domains board: { svg, style, source, generated_at }. svg is sanitized inner-SVG markup; source is llm|procedural. Null = fall back to the procedural motif.';
