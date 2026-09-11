# 02 — Core onboarding: fresh install to a useful workspace

**Depends on:** [01 — Framework](01-ONBOARDING-FRAMEWORK.md).\
**Requirement coverage:** R01–R04, R11, R15.\
**Goal:** A new owner understands the application, has a working or explicitly deferred AI connection, and has a small, usable starting structure.

## Reuse before building

The inspected repository already has `apps/api/src/lib/llm.ts`, `apps/api/src/routes/settings.ts`, dashboard-editable settings, integration status, and model/STT test endpoints. The README describes an existing first-owner creation script and installation workflow. Reuse these foundations; onboarding must not create a second provider configuration store. See [S1–S4](00-START-HERE.md#repository-baseline-and-sources).

The current settings implementation returns stored API keys in authenticated settings responses. That is an observed starting point, **not** the target security model. The new flow must not copy complete settings into draft state, model context, client analytics, diagnostics, or Markdown.

## Installation boundary

V1 configures an already installed application and connects an existing model service. It does not provision cloud accounts, purchase API credit, download model weights, or deploy an inference server.

Before the in-app wizard, improve the installation handoff: required configuration, database migration status, first-owner creation and the correct sign-in address. Keep the existing authenticated/CLI bootstrap unless there is already a secure one-time setup mechanism. Do not introduce publicly reachable unauthenticated credential-setting routes.

Some failures happen before the application can render, such as an unreachable database or missing authentication secret. Cover these in deployment preflight and documentation, not an imaginary working wizard behind a broken server.

The owner confirmed that fresh installs should seed only required system records. Split the current original-owner domains out of `infrastructure/seed.sql` into explicit demo/test fixtures, keeping Inbox's fixed UUID and required singleton rows. Update bootstrap documentation and tests together. Do not delete or rename existing installations' domains by recognising their names. Implement the fresh-versus-upgrade setup state specified in 01.

## Screen C0 — Welcome and readiness

**Ask:** “What would you like help organising?” as optional context, plus confirmation of timezone and household display currency. Show a suggested timezone for confirmation; do not assume the repository's existing default is appropriate for every installation.

**Show:** What Jevi Ops does, what information stays local, and which optional connections may send data elsewhere. Run safe readiness checks for the database, authentication, migrations, upload storage and deterministic scheduling.

Classify checks as required for the core app or required only for an optional capability. A missing external webhook secret, optional calendar connection, or research worker is not automatically a core blocker. A configuration-present flag is not a successful connectivity check.

**Save:** Confirmed timezone/currency through existing settings services. Explain that those saves take effect immediately.

**Exit:** Fix true infrastructure blockers using clear instructions. Otherwise continue, with optional capabilities visibly unavailable.

## Screen C1 — Connect an AI provider

**Ask:** “Where should Jevi Ops send AI requests?” Offer only paths supported by the code and configuration: an OpenAI-compatible endpoint, the existing Anthropic adapter, or “Set up later.” Describe local versus remote hosting without assuming the adapter name tells you where data travels.

| Field | Behaviour |
|---|---|
| Provider/adapter | Required only when enabling AI; use existing enums |
| Endpoint/base URL | Needed for compatible servers; validate and show the resolved target without credentials |
| Model identifier | Allow manual entry; a models-list endpoint is an optional convenience, not a dependency |
| API key | Secure entry when needed; local endpoints may legitimately use no key |
| Credential source | Distinguish a saved override, environment configuration and intentionally no credential |
| Test action | Test a candidate config without temporarily changing the global active config |

Tests execute from the API runtime, not only the browser: the server must be able to reach the model. Distinguish invalid address, unreachable host, timeout, authentication failure, missing model and unsupported request shape. Return sanitised errors, not raw request headers or provider secrets.

Test text generation first. Test structured interpretation and tool-call support separately before advertising those capabilities. A successful ping does not prove external research or reliable tool use. Keep bounded output and time limits.

**Save:** Apply the tested candidate through the existing settings resolution/cache-invalidation path. An explicit “Save without a successful test” can be supported with a degraded status; never show it as ready. Test and ordinary use must resolve settings in the same way.

**Skip:** Continue in manual mode. Explain precisely which features will be unavailable and link to Settings → AI for later setup. Preserve the draft if a test fails.

## Credential and endpoint requirements

Expose a redacted read shape such as `configured`, `credential_source` and last-tested status. Use explicit replace/clear/use-environment operations; an empty masked input must not accidentally clear a secret, and a null field must not misleadingly mean “no key” when it actually activates environment fallback.

Changing provider or endpoint must not silently send an old provider's key to a new host. Bind credentials to their intended configuration or require an explicit selection. Keep bootstrap secrets in the established environment/secret mechanism. For dashboard-managed credentials, use encrypted storage or an existing protected secret reference, with its encryption key outside the database and a documented backup/restore dependency. Do not claim encryption exists without implementing and testing it.

Restrict who can configure or test arbitrary endpoints. Allow deliberate local, private-network and Tailscale addresses because self-hosting is a core use case; a blanket private-address ban would break the product. Apply endpoint policies, redirect checks, bounded responses and credential scoping instead of exposing a generic network fetch proxy. Require explicit acknowledgement for credentials sent over non-local unencrypted transport, or reject that transport according to the deployment policy.

Never put secrets in onboarding drafts, model prompts, URL query strings, error reports or agent-readable bundles. Migrate the existing Settings UI together with the API response contract so redaction does not break editing.

P1's concrete default is a redacted public settings DTO separate from the internal resolved configuration, with explicit keep/replace/clear/use-environment credential actions. Redact successful PATCH responses as well as GET and errors. Restrict credential reads/writes and arbitrary endpoint tests to owner sessions immediately; fine-grained worker scopes are a later extension, not a reason to delay this boundary. Use expected configuration revisions on saves and associate capability-test results with the tested configuration fingerprint.

Use authenticated encryption for dashboard-managed secrets with a dedicated versioned encryption key supplied outside Postgres. Include key provisioning, plaintext migration, rotation, backup/restore and wrong/missing-key tests in P1. Decryption failure degrades the affected integration explicitly; it must not silently fall back to another credential. Bootstrap keys stay outside wizard state. This is planned implementation, not a description of current storage.

## Screen C2 — Optional integrations

**Ask:** “Which connections would be useful now?” Show the configured capabilities, not an obligation to connect every available service.

Start with existing integrations: transcription, notifications, calendar and media/storage features. Each card explains purpose, requested access, where data travels, current status, test behaviour and how to disconnect. External research is a separate capability card and can remain unconfigured.

Connect one at a time; failures do not undo a working model connection or block basic use. Keep service secrets in their existing protected configuration path, not in session JSON. An integration test that sends a real notification or writes externally must be explicit about that side effect.

The inspected STT test can regard an HTTP 401/403 response as `ok`; fix or relabel that result before reusing it as a readiness signal. Reachable-but-unauthorised is not transcription-ready. No-audio reachability tests must be distinguished from an actual transcription check.

## Screen C3 — Seed domains and areas

**Ask:** “Which parts of life or work would you like to organise?” Accept a short conversational answer, selectable examples and editable fields. Keep examples optional and small. Suggested domains might include Home, Family or Vehicles, but none is compulsory.

When a model is available, it can propose a structure. Without it, offer a manual list. In either case, preview the exact domains and objects to create or reuse and let the owner rename, deselect or approve them.

Use the repository's model: the recent stack makes an asset an area through assignment to a domain. Do not create a generic `areas` table or a second vehicle-area record just because the conversation used the word “area.” Inspect existing non-asset organisational concepts before adding new types. See [S7](00-START-HERE.md#repository-baseline-and-sources).

Explain the distinction through a small example: a long-lived domain, a vehicle asset with ongoing responsibilities, a finite improvement project, and an actionable task. Keep routine maintenance in the existing maintenance model, not recurring copies of an improvement project.

Search existing domains/assets before creation. Retrying or rerunning setup must not duplicate them. Name similarity is a suggestion, not sufficient authority to merge existing records. Preserve stable IDs and existing names unless the user chooses a change.

Apply the approved structure at C3 using its own transaction and operation receipt; label the immediate effect. Core completion and retries reuse the receipt. Preserve existing general-purpose areas represented by `projects.kind = 'area'`; a vehicle acting as an area uses its asset record and does not also need a duplicate area project.

## Screen C4 — Optional specialised setup

Offer the vehicle module as “Add a vehicle now” or “Do this later.” Both entry points invoke the same module as the normal application. There must be no first-run-only copy of its screens or validation.

Let the user finish core setup with no vehicle, or with a vehicle flow deferred part-way. A later Add vehicle action must not require rerunning provider setup or domain seeding.

## Screen C5 — Learn by doing

Offer a small optional practice interaction using the real application paths: capture one item, file it into the chosen structure, and review a proposed change where that capability exists. Explain where captured items land and how they become tasks, notes or projects.

Use a user-provided example or an explicitly labelled disposable demo item. Do not silently create demonstration clutter, fabricate a service event, or mark work complete to show a success animation. Permit skipping this lesson.

With no model, demonstrate ordinary manual capture and editing. With conversational assistance, show interpreted fields and the distinction between a suggestion and an applied change. Do not pretend that attaching a model has installed an autonomous librarian or external agent.

Use the Capture grid's existing create forms for the manual lesson. The free-text Capture box, despite accepting typed text, uses the model-dependent voice/parser pipeline and is not a manual-mode fallback.

## Screen C6 — Ready summary

Show what is actually ready: essential infrastructure, AI capabilities tested, integrations connected, initial organisation created, optional modules completed/deferred, and any known limitations.

The completion label is “Workspace ready” or “Ready in manual mode,” not “Everything verified.” The primary action opens the normal working interface. Secondary links return directly to missing setup sections. Do not display a perpetually incomplete setup banner merely because optional services were skipped.

## Implementation tasks

- [ ] Add deployment preflight and a clear first-owner/sign-in handoff using existing scripts.
- [ ] Build a safe readiness aggregator with required-versus-optional capability distinctions.
- [ ] Refactor settings reads/writes for redacted credentials and explicit credential actions; migrate the old form.
- [ ] Add candidate-configuration tests, bounded timeouts and separate capability results.
- [ ] Implement C0–C2 using the existing provider/integration services.
- [ ] Implement editable, previewed and idempotent domain/asset seed proposals using normal commands.
- [ ] Wire the vehicle module and support core completion independently of it.
- [ ] Add the optional practice interaction and honest readiness summary.
- [ ] Test fresh installs, upgrades, unsupported model-list APIs, unavailable AI, revoked credentials and configuration changes after onboarding.

## Acceptance criteria

A fresh owner can reach a useful workspace with either a tested model or an explicit manual-mode choice. No connection requires a generic research harness. Every optional integration can be skipped and configured later. Secret reads are redacted, switching endpoints does not leak credentials, and failing tests preserve user input. Domain seeding is reviewable and idempotent. Existing installations are never wiped, reseeded or forced through a full first-run path.
