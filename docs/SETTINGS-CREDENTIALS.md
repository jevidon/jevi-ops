# Settings credential operations

Migration 0053 adds revisioned settings, encrypted credential envelopes and capability-test receipts. Only owner sessions may read settings, change credentials or test endpoints. API tokens cannot use these endpoints. Configure LLM, STT and Immich in Settings; provider tests use candidates and do not change active settings.

Supply `SETTINGS_ENCRYPTION_KEYS` as a JSON object mapping version IDs to **32-byte hexadecimal AES keys**, and `SETTINGS_ENCRYPTION_ACTIVE_KEY` as the version used for new encryption. These environment values are loaded from the established root `.env` or the process environment. Keep that file readable only by the deployment account. A secret manager may inject both values instead. They are independent of `AUTH_SECRET` and never belong in PostgreSQL, source control, onboarding drafts, agent instructions or request URLs.

Generate a key with `openssl rand -hex 32` and store it through the deployment's protected secret mechanism. Example structure (replace the explanatory placeholder with a generated 64-character hexadecimal key):

```dotenv
SETTINGS_ENCRYPTION_KEYS='{"v1":"<64 hex characters>"}'
SETTINGS_ENCRYPTION_ACTIVE_KEY=v1
```

Environment-managed provider keys remain in `LLM_API_KEY`, `ANTHROPIC_API_KEY`, `STT_API_KEY` and `IMMICH_API_KEY`. They bind to their respective environment endpoint; setting a dashboard URL to another host never forwards the old environment key. “Use no credential” explicitly suppresses fallback. “Use environment” deliberately selects the environment key for its matching endpoint. Changing provider or endpoint requires a new selection when a key is present. For Anthropic the adapter always uses its official HTTPS endpoint.

HTTPS and loopback HTTP accept credentials. Sending a credential to any other HTTP endpoint requires the Settings acknowledgement for that integration. Private network and Tailscale URLs are supported. Requests reject redirects and URLs with user information, queries or fragments. Both candidate and ordinary model calls use the same resolver, credential binding and bounded adapter transport. Text, structured output and tool calls are separate tests. STT's models probe verifies authenticated reachability only; it does not claim to have transcribed audio. Worker research is a separate capability.

## Upgrade from plaintext

Back up the database and current secrets before applying migrations. Apply 0053 using the normal migration runner, provision the keyring, then run from the repository root:

```sh
pnpm --filter @jevi-ops/api exec tsx scripts/settings-credentials.ts status
pnpm --filter @jevi-ops/api exec tsx scripts/settings-credentials.ts migrate
```

The command prints the database host/port/name, never credentials. Existing `llm_api_key` and `immich_api_key` columns remain quarantined after the SQL migration. They are never returned by the API or used for provider requests. Affected integrations show `migration_required` until encrypted. Encryption and clearing plaintext occur in one transaction, so failure preserves original values. Retrying `migrate` is safe. If a migrated key is used over non-local HTTP, explicitly acknowledge that transport in Settings or use the migration command's `--acknowledge-insecure` option after verifying the target.

No generated key is silently substituted for a missing key. After verification, normal backup retention should age out historical plaintext database snapshots. Preserve backups according to your own restore policy; this migration does not delete them.

## Rotation and restore

1. Add a newly generated key as a new ID while retaining all existing IDs. Point `SETTINGS_ENCRYPTION_ACTIVE_KEY` at the new ID and restart the API to load changed `.env` values.
2. Run `pnpm --filter @jevi-ops/api exec tsx scripts/settings-credentials.ts rotate`. It decrypts each old envelope and re-encrypts with the active version in a single transaction. If any old key is missing/wrong, nothing is rewritten.
3. Test every affected integration. Remove an old key only when no retained database backup requires it, or archive that old key separately with protected recovery materials. Never change a key's bytes under its existing ID.

A database backup alone cannot recover managed credentials. Back up the keyring separately with restricted access, and restore the matching key versions alongside the database. Missing keys, wrong bytes, tampering and swapped configuration bindings fail closed (`locked` or `binding_mismatch`). Manual operation and other integrations remain available. Restore the original keyring, or explicitly replace/clear the affected credential in Settings. No error path switches silently to environment credentials. The API exposes no decryption/export endpoint.

## API compatibility

GET and PATCH settings responses omit raw keys and encrypted envelopes. PATCH requires `expected_revision`; a stale form receives HTTP 409. Credential actions are `keep`, `replace` with `value`, `clear`, or `use_environment`. The legacy `llm_api_key`/`immich_api_key` PATCH fields are rejected. Tests POST to `/api/settings/test-llm`, `/api/settings/test-stt`, or `/api/settings/test-immich` with an optional `candidate` PATCH object. LLM tests also select `capability: text|structured|tools`. Results bind to the exact resolved endpoint, model, credential and transport policy; a setting or environment change removes mismatched results from active readiness.
