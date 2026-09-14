# Capture program — branch audit (Gate A)

**Inspected:** 14 September 2026, read-only.
**Base:** `main` @ `1fc307c` (PR #46 merge) — the handoff's pinned baseline. Work lands on `feat/durable-capture`.
**Migration head on main:** `0052_currency_visit_outcomes.sql`; this program adds `0053_durable_capture.sql`.

Context: the unmerged PRs #48–#50 (`codex/onboarding-*`: encrypted credentials, onboarding, private sources, vehicle knowledge, research workers, monitoring; migrations 0053–0059) are being scrapped. This program deliberately does **not** depend on any of them: the token profile columns are created here, endpoint policy reads `main`'s own LLM/STT config, and the Hermes plugin lives outside the research worker tree. If those PRs are later revived, their `api_tokens` profile columns and migration numbers must be reconciled with 0053.

This document records inspected facts, chosen defaults, and remaining unknowns separately. It does not claim runtime or deployment behaviour that was not observed.

## 1. What `main` provides that this program reuses

| Capability | Where | Reused for |
|---|---|---|
| Transaction plumbing | `apps/api/src/lib/maintenance-tx.ts` (`inTransaction`, `DbOrTx`, `Tx`) | every capture write |
| Session JWT + hashed revocable `ops_` tokens | `apps/api/src/plugins/auth.ts`, `routes/auth.ts` (`signSession`, `hashApiToken`) | the `capture_client` profile is added on top |
| Idempotency precedents | `maintenance_logs.event_key`, `attention_items.dedup_key` (`onConflictDoNothing`) | design of `operation_receipts` |
| Parser / executor / STT / LLM | `lib/parser.ts` (`parseTranscript`), `lib/executor.ts` (`executeActions`), `lib/stt.ts`, `lib/llm.ts` | the transitional bridge; `llmBaseUrl()`/`sttBaseUrl()` are added for the policy check |
| Settings singleton with boolean flags | `app_settings`, `lib/app-settings.ts` | `capture_async_enabled`, `data_space_id`, `server_epoch` |
| Test harness | disposable `jeviops_test`, `test/upgrade.test.ts` (populated 0047 → head), `test/web-actions.test.ts`, web jsdom suite | extended, not replaced |

Added as small shared utilities because `main` lacks them: `lib/command-error.ts` (`CommandError`), `apps/web/src/lib/client-id.ts` (UUIDs on plain-HTTP origins).

## 2. Capture and ingest on `main` (the problems the handoff describes)

- `POST /api/ingest` (`routes/ingest.ts`): shared secret, direct `captured_data` insert, `201 {id, created_at}`. Without `DATABASE_URL` it logged the whole body and returned `202 {status:'accepted_no_db', stub:true}` — a false success. 500 leaked the raw Postgres message.
- `POST /api/ingest/capture`: 503 when the LLM or DB is unconfigured **before** any write, then synchronous parse + execute.
- `POST /api/capture/voice`, `/voice-audio`, `/warm`, `/transcribe` (`routes/capture.ts`): no durable write before inference; audio is read into memory, transcribed, discarded. Response shapes `{status:'executed'|'needs_disambiguation'|'parse_error', …}` are what the web's `shapeResponse()` consumes.
- `captured_data`: uuid id, `source` CHECK (`zapier|cowork|n8n|manual|webhook|smart_glasses|watch|other`), `processed_status` CHECK (`raw|parsed|displayed|archived`); no reader anywhere; nothing updates `processed_status`.
- `lib/executor.ts` `executeActions`: sequential loop, no transaction, no idempotency; 15 handlers; `create_calendar_event` pushes to Google before the local insert.
- STT default base URL is `https://api.openai.com/v1` when nothing is configured (`lib/stt.ts`); LLM: `app_settings.llm_*` → env.
- `lib/storage.ts`: human-readable filenames, `exifr` GPS, external Nominatim reverse geocode. `server.ts` serves `/uploads/*` via `@fastify/static` with no auth.
- Global error handler returns `err.message`.
- `GET /api/settings/app` returns the full settings row (including `llm_api_key`) to an authenticated caller — unchanged here; noted for later.

## 3. Table classification

`main` defines the 0052-era schema: domain tables (projects, domains, people, companies, conversations, tasks, milestones, content, library, health, routines, assets, maintenance items/logs/visits, readings…), Markdown bodies with `doc_revisions`, media-holding jsonb columns, `app_settings` (contains provider keys), `google_oauth_tokens` (plaintext), `auth_user`, `api_tokens`, operational tables (`captured_data`, notifications, observations, attention_items, resurfacing_seen, action_log). No `deleted_at` anywhere; archived/void flags exist on content, routines, assets, readings, tokens.

New in 0053: `operation_receipts` (ledger), `capture_receipts`, `capture_media`, `capture_attempts` (operational); `api_tokens.permission_profile` + `scopes`.

## 4. Writer inventory (summary)

API routes write domain tables directly or through `lib/maintenance.ts` / `lib/visits.ts` / `lib/docs.ts`; 40+ web server actions all go through `apps/web/src/lib/api.ts` (no direct DB access); `lib/executor.ts` writes 13 tables; the in-process scheduler (`lib/scheduler.ts`) runs reminders, calendar sync, observations, overdue, daily summary, maintenance sweep, attention; `routes/cron.ts` exposes the same functions. Legacy Supabase scripts under `apps/api/scripts` bypass validation (likely dead). No external SQL access is provisioned to agents.

## 5. Deployment facts

Production launchers `scripts/start-api.sh` / `start-web.sh` are foreground tsx/next processes for PM2; no ecosystem file or worker supervisor in the repo. Dev: `scripts/devctl.sh` manages `api` and `web`. Migrations via `scripts/db-migrate.sh`. Dev `.env` on this machine defines LLM_BASE_URL (port 8089, not listening at inspection time), UPLOADS_DIR, secrets; `STT_BASE_URL`, `CAPTURE_MEDIA_DIR`, `LOCAL_INFERENCE_ORIGINS` unset.

## 6. Hermes install facts (owner's interactive runtime)

- `hermes --version`: **v0.18.2 (2026.7.7.2)**, upstream `861d69c7` (2026-07-13), git install at `~/.hermes/hermes-agent`, Python 3.11.
- `~/.hermes/config.yaml`: model via custom provider at `http://127.0.0.1:8080/v1` (a proxy to a cloud model, not a local model); `stt.enabled: true` with local whisper `base`; `plugins.enabled` absent.
- Plugin surface (from `hermes_cli/plugins.py`): user plugins in `~/.hermes/plugins/<name>/` with `plugin.yaml` + `__init__.py:register(ctx)`; `ctx.register_command(name, handler, description, args_hint)` registers an in-session slash command (`handler(raw_args) -> str|None`); rejected if it collides with a built-in (`/save` is built-in; `/capture` is free). `VALID_HOOKS` include `pre_llm_call`, `post_llm_call`, `pre_gateway_dispatch` (messaging gateway only, before auth).
- Desktop: `hermes desktop` is an Electron app talking to `tui_gateway/server.py`, which resolves plugin slash commands **in-process before any model dispatch** (`get_plugin_command_handler`, `tui_gateway/server.py` ~L11959).

## 7. iOS

`apps/ios` is a WKWebView shell with a JSON pending-task queue; not the native local-first client of handoff doc 06; untouched until Gate D/E.

## 8. Chosen defaults (Gate A)

- Ledger identity `(data_space_id, operation_id)`; `app_settings.data_space_id` generated once by 0053; `server_epoch` starts at 1.
- Digest = SHA-256 of canonical JSON (sorted keys, no whitespace, UTF-8) of the envelope minus `operation_id`; fixture in `packages/shared/fixtures/durable-capture/digest.json`, shared with the Python plugin.
- Legacy `captured_data.source` mapping: user-originated web/Hermes → `manual`; `/api/ingest` keeps the caller's value. Client provenance goes in `capture_receipts.client`.
- Media: whole-file PUT ≤ 26 214 400 bytes (matches the existing multipart limit), `resumable:false`; `CAPTURE_MEDIA_DIR` separate from `UPLOADS_DIR`.
- Inference policy: loopback always approved; other origins via `LOCAL_INFERENCE_ORIGINS`.
- Flags: one, `capture_async_enabled` (default false). Token profiles: `legacy` (all existing tokens) and `capture_client`.

## 9. Flagged, not fixed

- `/uploads/*` is public; new capture media never lands there.
- STT defaults to OpenAI cloud when unconfigured; the new flow refuses it via policy, legacy routes do not.
- Global error handler and `/api/ingest/capture` surface `err.message`; `/api/ingest/capture` still loses transcripts on 503 (Gate C reroutes it).
- `executeActions` is non-transactional; Gate B's bridge is conservative, Gate C replaces it.
- `GET /api/settings/app` returns provider keys to authenticated callers (pre-existing on `main`).
- Legacy Supabase scripts under `apps/api/scripts` bypass validation.

## 10. Gate mapping to the handoff

| Handoff | This program | Note |
|---|---|---|
| A verified contracts and safety | PR1 | this document + contracts + 0053 + auth + policy |
| B reliable capture | PR2–PR4 | web two-step save/interpret, Hermes `/capture` saved-pending |
| C asynchronous understanding | Gate C | `capture_jobs`, Hermes consumer, replay-safe application |
| D offline vertical slice | Gate D | sync **and** the native first slice (doc 06) |
| E complete coverage | Gate E | full native coverage, restore drills |
