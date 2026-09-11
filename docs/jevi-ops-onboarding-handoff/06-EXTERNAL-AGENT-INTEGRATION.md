# 06 — External research and agent integration

**Depends on:** Safe settings/owner boundaries in [02](02-CORE-ONBOARDING.md), safe context in [04](04-VEHICLE-RECORDS-AND-MARKDOWN.md), assessments/manual management in [05](05-COMPLIANCE-AND-MANUAL-MANAGEMENT.md).\
**Requirement coverage:** R11–R15.\
**Release:** M2; optional at runtime, but an explicit implementation workstream.\
**Outcome:** A real configured external worker can research one vehicle question, return sourced findings and propose a safely reviewable update.

**Acceptance update, 11 September 2026:** The worker package and integration have been implemented and checked against the pinned runtime and deterministic fixtures. The owner requested skipping the live Hermes test for this handoff. The live test described below remains a future verification procedure, not a current completion blocker or a passed check. See [implementation evidence](10-IMPLEMENTATION-STATUS.md) and the [deferred test](11-LIVE-WORKER-ACCEPTANCE.md).

## Important correction to the verbal planning

The inspected LLM adapter already supports tool definitions and tool-call results, and settings describe a chat tool-use loop. Therefore “Jevi Ops has no tool calls” is not a sound premise. What this work must establish is the complete external research capability: tool execution, approved sources, provenance, result validation, review and controlled persistence. See [S3–S5](00-START-HERE.md#repository-baseline-and-sources).

First inspect current tool registrations and agent interfaces. This targeted handoff inspection does not prove that every required research component is absent. Reuse compatible mechanisms that exist on the current branch.

## Architecture

```text
Jevi Ops owner request or enabled review policy
  -> durable research request + minimal context references
  -> configured external worker claims the request
  -> worker fetches sources and evaluates the question
  -> sourced result submitted to Jevi Ops
  -> validated findings and an inert change proposal
  -> owner reviews evidence, uncertainty and effects
  -> Jevi Ops applies accepted changes through normal services
```

Jevi Ops does not need a browser embedded in its web UI or a new unrestricted autonomous agent. The owner selected a new Hermes installation as the first runtime; no existing worker is available. Build the worker setup package and bounded adapter together. Verify the selected Hermes version's actual capabilities and extension surface before claiming integration.

Implement one working adapter, not a collection of unsupported placeholders. Keep the boundary provider-neutral so a later harness can replace the first one without changing vehicle identity, document ownership or maintenance semantics.

## New Hermes worker package — required M2 deliverable

Deliver version-controlled setup files under `workers/hermes/` (the canonical implementation location) with a runnable polling adapter in the repository. Use a dedicated Hermes profile rather than cloning an owner's general assistant state. Official [profile documentation](https://hermes-agent.nousresearch.com/docs/user-guide/profiles/) describes separate configuration, instructions and skills, and makes clear that profiles are not filesystem sandboxes. Enforce API permissions and runtime isolation independently of instructions.

The package includes:

- `README.md`: installation prerequisites, tested Hermes version/commit, profile creation, credential provisioning, start/stop, health checks, upgrades, backup and recovery.
- `config.yaml.example` and `.env.example`: model/tool configuration, API address, bounded runtime settings and secret placeholders. No real keys or owner profile state in Git.
- `SOUL.md` for the worker role and workspace `AGENTS.md` for the research/application boundary. The worker researches, retains evidence and submits proposals; it cannot approve or apply them.
- `skills/jevi-vehicle-research/SKILL.md`, supporting API/schema references and deterministic examples. Use Hermes' documented [skill format](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/), not an assumed single `skills.md` entrypoint.
- Bootstrap/start/stop/health and smoke-test tooling that creates the dedicated configuration deliberately, does not overwrite an existing profile, and verifies the expected instructions/skills are actually loaded.
- Executable claim/lease/heartbeat/result integration, request-scoped context access, evidence retention, retry/cancellation behaviour and test fixtures. Instructions must not be the only implementation of transport, authentication or validation.

Jevi Ops owns policy and review-job creation; the worker polls and executes. Do not independently schedule the same reviews in Hermes cron. Hermes' [cron documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/) distinguishes detached jobs from jobs with a workspace, so placing `AGENTS.md` in a directory is not proof that every execution loads it. Test the actual launch path and required skills.

Implement against a pinned, tested Hermes release/commit and record the supported tool/provider configuration. The runtime host, model endpoint and credentials are deployment inputs supplied securely when instantiating the worker; they do not need to be invented in this plan. First-run acceptance instantiates a fresh worker in a controlled environment and runs a real source-backed request against a test vehicle. Installing templates alone does not complete P8 or justify enabling monitoring.

## Capability discovery and setup

Record a safe connection descriptor: adapter identity/version, enabled capabilities, allowed task types, last health check and last successful relevant run. Separate text generation, external fetch/search, document extraction and scheduled research.

A connected model is not a connected research worker. A responding worker is not proof that its browser credentials, source access or scheduled execution work. Expose `not_configured`, `configured_not_tested`, `ready`, and `degraded` with explanatory detail. Do not say “monitoring” until the additional conditions in [07](07-PROACTIVE-VEHICLE-MANAGEMENT.md) are met.

Worker credentials remain outside vehicle documents and ordinary model context. Setup should show required network/source permissions and test a harmless research operation before activation.

## Proposed contracts

These are logical contracts; reuse an existing job/proposal model where it meets the invariants. Route names and persistence additions must be checked against the branch.

### Research request

Required information:

- Stable request ID, schema version, request type, deduplication/operation key and creation time.
- Target asset IDs and an explicit question, such as which known responsibilities need verification.
- Relevant jurisdiction and minimal typed vehicle facts, including unknowns.
- Context references, document version and relevant fact/assessment preconditions.
- Allowed source scope, privacy limits, time/request budget and requested evidence format.
- Origin: owner request or an enabled review policy; authentication-derived requester identity.

Use source and context references rather than embedding all household data. Full VIN, plate, provider keys and unrelated files must be excluded by default. Public research usually needs class/specification facts, not the owner's identifying data.

### Research result

A successful result contains:

- Request ID, authenticated worker identity, run ID and result operation key.
- Outcome (`findings`, `no_supported_change`, or `insufficient_evidence`) and a concise summary.
- Source records actually fetched: URL/reference, publisher, title, retrieval time, publication/effective dates if known, content hash or snapshot reference, and precise supporting locations/excerpts.
- Claims linked to those source records, explicitly separating facts, interpretation, recommendations and open questions.
- Proposed changes expressed as allowed domain operations with expected prior values/versions.
- Missing vehicle facts, uncertainty, affected assets and reasons no change can yet be applied.

A plausible URL written by a model is not fetched evidence. Every citation in a claim must resolve to a supplied, retained source record. A successful network call with no relevant support must return insufficient evidence, not an invented conclusion. Keep source retention within the deployment's privacy and content-storage policy.

### Proposal

A proposal records source result, target records, a human-readable before/after diff, reason, evidence, uncertainty and downstream effects on tasks/schedules/documents. It also carries the exact facts and versions on which it relied.

Allow only typed operations such as a profile-fact proposal, applicability-assessment change, supported maintenance-policy edit, or versioned document amendment. Do not accept arbitrary SQL, shell commands, unrestricted JSON patch paths or arbitrary HTTP requests as an executable proposal.

## Job and proposal lifecycles

Keep execution status separate from approval status:

```text
Job: requested -> leased -> running -> succeeded | failed | cancelled
Proposal: pending_review -> approved -> applied
                         -> rejected | superseded | conflicted
```

A worker can finish successfully while its proposal still awaits review. It cannot report the canonical state changed merely because it returned text. A no-change result can update a successful-check timestamp only when it actually checked the relevant sources and question.

Use bounded leases, heartbeats or equivalent ownership, and retry limits. Reclaim an expired lease without generating duplicate proposals. A retried result with the same operation key must return the original receipt; the same key with different content is a conflict. Use backoff for transient failures and stop after the configured limit.

## Authentication and approval boundary

Use a dedicated revocable worker credential and enforce least privilege server-side. Desired permissions are limited to reading allowed asset context, claiming permitted requests and submitting results/proposals. The worker must not read secrets, mint tokens, approve itself, or directly mutate accepted compliance state.

The repository has named API tokens, but naming a token is not proof of scope enforcement. Verify the existing authentication layer. If fine-grained scopes are missing, implement them and audit **legacy generic write routes** as well as new research routes. A proposal-only token must not bypass approval by calling the old asset or maintenance PATCH endpoint directly.

Preserve existing integrations through an explicit migration/credential transition; do not silently give a new worker legacy-wide permissions. Derive actor and worker identity from the credential. Bind reported run IDs to the claimed request rather than trusting caller-supplied actor labels.

Direct owner edits use the normal manual save path. Agent-originated consequential changes require owner approval by default. Approval must refer to a concrete proposal, not a broad grant such as “do whatever the research says.”

## Applying accepted changes

On approval, re-read relevant facts and record versions. A stale proposal that depends on changed jurisdiction, vehicle classification, schedule state or document text must be re-evaluated or return a conflict. Never resolve it through a hidden forced overwrite.

Validate and apply accepted changes through the existing asset, reading, document and maintenance services. Preserve task reconciliation, evidence rules and document history. Link the applied assessment, document amendment and task effects to the proposal and audit record. Store an idempotent application receipt.

Use transactions where changes must be one fact. Preserve the existing lock order. For multi-vehicle proposals, use explicitly tracked per-vehicle applications or a safe atomic batch; never report all affected vehicles updated when only one succeeded.

An undo/correction is a new auditable operation and must account for work done since approval. Do not promise a blind rollback can erase real completed services or external actions.

## Proposed API surface

| Operation | Access and behaviour |
|---|---|
| Create research request | Owner session or authorised enabled review policy; deduplicated |
| Get safe asset context | Scoped worker; extend/wrap the existing asset bundle |
| Claim request | Worker capability and lease checks |
| Submit result | Worker bound to request; schema/evidence validation; idempotent |
| List/review proposals | Owner; display sources, unknowns, versions and consequences |
| Approve/reject proposal | Owner-only; approved changes applied by Jevi Ops |
| Read run/application status | Owner and appropriately scoped worker; no secrets |

An initial polling transport is a reasonable default; no message broker is required unless current deployment needs justify one. Polling, authentication and retries must be real implementations, not a diagram-only contract.

## Research guardrails

Treat web pages, PDFs, uploaded records and extracted text as untrusted content, never instructions. Limit source/network access and result size. Research cannot approve a purchase, contact a workshop, pay charges, submit a government form or change credentials under this scope.

Prefer appropriate primary authorities for regulatory claims. Source disagreement, proposed rules, unknown effective dates and missing vehicle facts must remain visible. Do not treat general model knowledge as verified current regulation. Keep the jurisdiction's terminology and rule scope explicit.

## Implementation tasks

- [ ] Inspect existing chat tools, tokens, proposal/audit mechanisms and installed harness capabilities.
- [ ] Implement safe context permissions and credential scopes, including bypass prevention on old routes.
- [ ] Define request/result/proposal schemas and durable job/application receipts.
- [ ] Implement claim, lease, timeout, retry and cancellation behaviour.
- [ ] Build one real external adapter and a harmless capability test.
- [ ] Build and verify the fresh Hermes worker package, instruction/skill loading, configuration templates, bootstrap and operational runbook.
- [ ] Validate and retain fetched source evidence; reject unresolved citation references.
- [ ] Build owner review with a before/after diff and explicit downstream effects.
- [ ] Apply accepted operations through normal services with stale-result protection and audit linkage.
- [ ] Run both deterministic mocked tests and a controlled end-to-end integration smoke test.

## Acceptance criteria

A real worker can answer an on-demand research question with retained sources, create a proposal and have an owner-approved change appear in the existing vehicle record. The worker cannot self-approve or bypass the proposal path through generic routes. Revoked credentials stop access. Unsupported evidence, malformed results and stale facts cannot mutate canonical state. Retry and timeout paths do not duplicate work. Disconnecting the worker leaves manual vehicle management fully usable.
