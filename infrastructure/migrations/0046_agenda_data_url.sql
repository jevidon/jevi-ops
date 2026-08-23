-- Migration 0046: Weather panel data-bundle URL.
--
-- InkyPi (the device rendering the Frame image) now publishes the data
-- BEHIND the image as JSON at /api/current_data (its PR #2) — the template
-- params of the rendered plugin. The Agenda's Weather panel consumes that
-- bundle server-side and renders the information natively instead of
-- scraping pixels. Null hides the panel. Fetched by the Next server (not
-- the browser), so no CORS/mixed-content concerns.

alter table app_settings
  add column if not exists agenda_data_url text;

comment on column app_settings.agenda_data_url is
  'URL of the InkyPi current_data JSON bundle for the Weather panel (fetched server-side, ~5 min revalidate). Null hides the panel.';
