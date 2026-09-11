-- Application-managed credentials are AES-256-GCM envelopes. The external
-- keyring is never stored here. Existing plaintext is quarantined until the
-- explicit settings-credentials.ts migrate command can encrypt it; runtime
-- use fails closed in the meantime. No destructive credential deletion.
alter table app_settings add column if not exists revision integer not null default 1;
alter table app_settings add column if not exists credential_settings jsonb not null default '{}';
alter table app_settings add column if not exists capability_tests jsonb not null default '{}';
alter table app_settings drop constraint if exists app_settings_revision_check;
alter table app_settings add constraint app_settings_revision_check check (revision > 0);
alter table app_settings drop constraint if exists app_settings_credential_settings_check;
alter table app_settings add constraint app_settings_credential_settings_check check (jsonb_typeof(credential_settings) = 'object');
alter table app_settings drop constraint if exists app_settings_capability_tests_check;
alter table app_settings add constraint app_settings_capability_tests_check check (jsonb_typeof(capability_tests) = 'object');
