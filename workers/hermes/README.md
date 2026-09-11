# Jevi Ops Hermes worker

This package creates a new, isolated Hermes installation for owner-requested vehicle research. It includes a real polling adapter, a single bounded public fetch tool, and the profile/instruction/skill files it loads. Findings are proposals; this worker cannot approve them or modify canonical records.

The canonical package is `workers/hermes/`, as recorded in handoff plan 06. Nothing is installed into an existing personal Hermes profile.

## Pinned runtime and verified interfaces

Hermes Agent **0.21.1**, release tag **v2026.9.7**, commit **2237be355906fbe6065ce1815711eee52b2d646e**, Python **3.11**. Bootstrap checks the tag's commit and installs the release's `uv.lock` with `uv sync --frozen --no-dev`. It does not run an unpinned remote installer. `runtime.json` records the pin and adapter version.

The adapter uses the pinned release's `AIAgent`, `registry.register`, and `run_conversation(system_message=...)` interfaces. Its scoped system-prompt hook explicitly loads `SOUL.md`, workspace `AGENTS.md`, the skill, and its output contract; it disables automatic ancestor context and memory loading. Generic interactive-chat steering markers and host/user/home metadata are excluded from the model prompt. `health.sh --check-runtime` exercises the actual pinned Hermes system-prompt hook and verifies that the only available tool is `jevi_fetch`. Hermes's default tool-search bridge is disabled in this profile so it cannot add another tool surface.

Official references: [release](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.7), [profiles and their isolation limits](https://hermes-agent.nousresearch.com/docs/user-guide/profiles/), [skill conventions](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/), [pinned runtime API](https://github.com/NousResearch/hermes-agent/blob/2237be355906fbe6065ce1815711eee52b2d646e/run_agent.py), [pinned tool registry](https://github.com/NousResearch/hermes-agent/blob/2237be355906fbe6065ce1815711eee52b2d646e/tools/registry.py).

## Prerequisites

- A Jevi API deployment with migrations through the research-worker schema, reachable over HTTPS or local loopback HTTP. Use a disposable test asset for the first smoke test.
- A newly registered worker named as desired, adapter `jevi-hermes`, adapter version from `runtime.json`, capability **external_fetch**, and the needed task types: `vehicle_question`, `responsibility_review`, `source_verification`.
- An API token minted for that worker with `permission_profile: research_worker`. Its scopes are only `research:claim`, `research:context`, `research:heartbeat`, `research:result`, `research:status`, `research:health`. An owner session creates/revokes it; it is never an owner or general API token.
- A separate model provider key, model identifier, and explicit **OpenAI-compatible chat-completions endpoint with tool calling**. Text-only connectivity is insufficient. Native Anthropic configuration is not supported by this adapter. Provider usage may incur cost; use bounded test requests.
- Git, [uv](https://docs.astral.sh/uv/getting-started/installation/), Python 3.11 or newer for the supervisor, and an operating-system user allowed to create an installation directory. uv installs the pinned Python 3.11 runtime when needed.

The package advertises public fetch only. It does not claim external search, PDF extraction, private receipt access, or general computer access. It can navigate links from permitted public HTML/text pages; put useful official URLs in the research question when available. A PDF-only question is unresolved with this adapter unless an equivalent supported primary source exists.

## Install and configure

From the repository root, choose a new directory outside the repository and your normal Hermes profile:

```sh
workers/hermes/scripts/bootstrap.sh --directory /absolute/private/jevi-hermes
```

Bootstrap refuses an existing destination. A partial failed installation stays in that new directory for inspection; correct the prerequisite and use a new directory. It never overwrites a profile or rotates an existing token.

Edit the generated `worker.toml` and `.env`. The `.env` file must remain mode `0600`; it contains only `JEVI_WORKER_TOKEN` and `HERMES_MODEL_KEY`, with one literal `KEY=value` per line and no shell expansion. Avoid logging or pasting populated files. The endpoint in `worker.toml` must correspond to the model key; credentials are never selected from ambient environment variables. The model HTTP client refuses redirects and requests to another origin. HTTPS is required outside loopback. The selected model, turns and output-token bounds are explicit configuration.

```sh
workers/hermes/scripts/health.sh --check-runtime --config /absolute/private/jevi-hermes/worker.toml
```

Expected offline output includes `runtime: 0.21.1`, `tools: [jevi_fetch]`, `instructions_loaded: true`, `model_called: false`. This checks the real installed code without contacting Jevi or a model. A populated key is unnecessary for this check.

Start a foreground supervisor after configuring the API token and model:

```sh
workers/hermes/scripts/start.sh --config /absolute/private/jevi-hermes/worker.toml
workers/hermes/scripts/health.sh --config /absolute/private/jevi-hermes/worker.toml
workers/hermes/scripts/stop.sh --config /absolute/private/jevi-hermes/worker.toml
```

Use your existing service manager if a persistent process is desired; point it at `start.sh` and restart only on process failure. The adapter does not register a cron job or its own research schedule. The API owns requested work and monitoring. A filesystem lock prevents a second supervisor for the same installation. Stop requests terminate the active child, attempt to release/fail its lease, then stop polling. If the API is unavailable, its 60-second lease expiry recovers the request.

Health distinguishes a running supervisor from a successful sourced check. API health preserves a private model/configuration/key-bound success marker. Fresh or changed configurations remain explicitly untested until a substantive model and public-fetch run succeeds. A failed/unresolved run stays degraded across polling; a heartbeat cannot erase it. Only an actual substantive result advances successful research timestamps. A local `health` response whose heartbeat is stale reports `fresh:false`.

## One real sourced smoke test

For the 11 September 2026 implementation handoff, the owner requested skipping this live test because Hermes is unavailable locally. The procedure remains available for a later configured installation. This exception closes the current build task without asserting live integration success or changing runtime capability checks.

1. Complete the offline runtime check above. In the owner UI, confirm the new worker is enabled and its permission profile is restricted.
2. Create a bounded request on a **dedicated test vehicle**, explicitly naming one question and permitting the necessary primary-source hostnames. Choose a question that can be resolved without VIN, plate, private receipts or assumed engine/fuel/class. To exercise an owner-approved change, request a supported responsibility/reference assessment with unknown applicability when facts are missing, instead of guessing a vehicle fact. Use a small source budget (for example 3 sources, 12 fetch requests, 180 seconds). External URLs and page content are untrusted.
3. Claim at most one request:

   ```sh
   workers/hermes/scripts/smoke.sh --config /absolute/private/jevi-hermes/worker.toml
   ```

   This invokes the real model and public sources. Exit `0` means a substantive result was delivered; `1` means a failed/unresolved run; `2` means no queued job. It does not mean the owner approved a change. The script never manufactures a result when the queue is empty.
4. Inspect the result in Jevi: actual source URLs, retrieval times, retained content hashes and literal supporting excerpts; distinct claims, uncertainty, missing facts and proposed changes. Verify a proposal preview against the current test asset, then explicitly approve it through the owner UI. Confirm the application receipt and expected typed-record or knowledge change. Edit the asset before a separate approval attempt to verify that a stale proposal is refused.
5. Record the runtime/adapter, job/result/proposal IDs, question, allowed domains, source URLs/hashes and owner application receipt in the test report. Exclude credentials. Revoke the test worker token and disable/remove the test setup when done.

No mock test, connected provider, runtime import, or empty queue passes M2. If model/provider access, an authorized test asset, primary sources, or owner review is unavailable, record that exact missing prerequisite. M1 manual operation remains available.

## Evidence, permissions and bounds

The supervisor retains the Jevi token and lease token. A fresh subprocess per job receives only the question, job-scoped safe context, budgets and a separate model key. Child environment uses an allowlist; ambient API/database/Hermes credentials are excluded. Model prompts never receive either Jevi token. Upstream diagnostics are discarded; supervisor logs contain fixed failure codes and IDs, never questions, credentials or raw documents.

Each run has a fresh `HERMES_HOME` copied from the secret-free template with only the packaged skill. Terminal, filesystem, messaging, cron, memory, plugins and generic HTTP tools are absent from the model tool set. Temporary profiles/results are removed at the end of the run. **A profile and tool restrictions are not an operating-system sandbox**: run the trusted, pinned runtime under a dedicated OS account or container without personal files and other secrets mounted. The runtime itself still has normal process/network permissions and the model key. Use normal host/container network controls if stronger infrastructure isolation is needed.

`jevi_fetch` permits only HTTPS on port 443 for the owner's allowed domains and subdomains. Every redirect is revalidated; every DNS answer must be globally routable. The TLS connection pins a validated IP while verifying the original hostname, preventing DNS rebinding to private services. It sends no cookies/authentication, bypasses ambient proxies, and rejects binary/non-UTF8 responses. Each redirect counts against the public request budget; a source counts only after successful retention. Limits are one MB fetched bytes per page, 200,000 characters retained text per source, 1.8 MB total retained UTF8 evidence, bounded sources/requests, per-fetch timeout and an overall hard deadline enforced by the supervisor.

Retained content is deterministic UTF8 text extracted from actual HTML/text, headed by its extraction version and original-byte SHA256. Its `content_hash` is SHA256 of that exact retained UTF8 content. The model cannot supply source bodies, URLs, hashes or retrieval times. It selects actual citation IDs and literal excerpts, which the assembler validates against the collector. Page instructions cannot create tool permissions or canonical changes. Hash/excerpt checks establish provenance, not correctness of a model interpretation; owner review is still required.

For API-issued shared-source reuse jobs (`max_requests:0`), the model evaluates only `context.retained_sources`. Network fetches are disabled by the budget, and original content hashes/retrieval times are preserved. The result does not claim a fresh retrieval. Each vehicle receives its own applicability result and stale-checkable proposal.

Context pages use only the leased job endpoint, never the generic asset endpoint or URLs suggested by a model. Pagination is bounded separately by `max_context_pages`; remaining omissions are explicitly marked. The adapter will not propose authored-document replacements or maintenance tracking changes with missing narrative/task preconditions. The backend can support those operation types for other adapters; this package proposes supported profile facts and responsibility knowledge, which owners can subsequently use for manual tracking.

## Recovery and updates

- `api_http_401`/`403`: stop and inspect token expiry, revocation, worker binding and required scopes. Mint a fresh restricted token through the owner UI; replace `.env` locally and restart. Do not broaden to a general token.
- `api_http_409`: lease lost, cancelled or stale. The process stops that run; it never submits through generic writes. Queue a new request if appropriate.
- `hermes_runtime_failed`/`model_run_incomplete`: check endpoint/model/tool support and configured key using a bounded request. Provider bodies are intentionally absent from logs.
- `unsupported_source_media`/`unsupported_source_encoding`/`source_too_large`: use an allowed primary-source HTML/text alternative or report unresolved. No extraction capability is advertised.
- Deadline/source/request bounds: narrow the question or deliberately adjust the next API request budget. The worker cannot increase it itself.
- Unknown result-delivery outcome: the same in-process result/key is retried up to three times. The API returns the existing receipt. A process crash loses the ephemeral local result; the API lease/retry policy controls recovery. It never blindly replays owner approval.
- For a runtime update, review a new release and its interfaces, update `runtime.json`, repeat isolated install/tests and a real smoke, then create a new installation. There is no automatic upstream update. Preserve the old installation until review completes, and rotate/revoke worker tokens intentionally.

Back up `worker.toml`, the secret-free profile templates and `runtime.json` as configuration. Back up `.env` only through your encrypted secret-backup process, separately from documents and ordinary repository backups. Canonical job/result/proposal evidence lives in Jevi Ops and follows its database/private-source backup process. Temporary `runs/` profiles are disposable and are not a durable result archive. Restore into a new installation, verify the pin/offline check, and mint a new restricted token when a backup's credential custody is uncertain; revoke the old token through the owner UI.

## Acceptance evidence, 11 September 2026

| Gate | Evidence | Status |
| --- | --- | --- |
| Fresh installation and pinned dependencies | Actual `bootstrap.sh` run in `/tmp/jevi-hermes-worker-smoke-install`; tag commit checked; upstream frozen lock installed | Passed |
| Actual launch loads role, workspace and skill; only intended tools | Packaged `health.sh --check-runtime` launches a fresh child and returns runtime 0.21.1 / only `jevi_fetch` / instructions loaded / model not called | Passed |
| Real Hermes tool loop, bounded fetch, provenance and credential separation | Python tests include actual pinned driver with a streamed local provider fixture; fabricated citations, redirect escape, private DNS and stale lease tests | Passed against deterministic fixtures |
| Skill packaging | Skill-creator validator on packaged skill | Passed |
| Live public-source answer and proposal | Requires an actual configured model endpoint/key and authorized test request | Skipped at owner's request; unverified |
| Owner preview, approval, stale refusal and application receipt | P7 backend / P8b owner UI; real-result loop was not run | Skipped at owner's request; unverified |

The first four rows establish the package and adapter mechanics. They do not prove live integration success or authorize monitoring. The owner waived the remaining live checks for the current implementation handoff.

## Tests and current verification

```sh
python3 -m unittest discover -s workers/hermes/tests -p test_adapter.py -v
/absolute/private/jevi-hermes/runtime/.venv/bin/python -m unittest discover -s workers/hermes/tests -v
```

The first suite exercises request/source budgets, redirect/credential/privacy boundaries, private-DNS rejection, real-content hashing, invented citation/excerpt rejection, proposal preconditions, scoped context and idempotent result delivery. The second additionally runs the **actual pinned Hermes tool-calling driver** against a disposable local model fixture and deterministic source fixture. It needs permission to bind a loopback socket; it does not use a paid provider or fetch a public page. Neither test is the M2 real-source smoke.
