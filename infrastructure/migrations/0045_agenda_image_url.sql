-- Migration 0045: Frame panel image URL.
--
-- The Agenda's new Frame panel shows a rotating image feed (e.g. a photo
-- frame service on the tailnet serving /api/current_image). The URL is a
-- setting, not a constant — IPs and hosts change. Null hides the panel.
-- The browser loads the URL directly; if the app is ever served over
-- HTTPS a plain-http URL here becomes mixed content and should move
-- behind an API proxy.

alter table app_settings
  add column if not exists agenda_image_url text;

comment on column app_settings.agenda_image_url is
  'Image URL for the Agenda Frame panel (fetched client-side, cache-busted periodically). Null hides the panel.';
