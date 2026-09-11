# 01 — Shared onboarding framework

**Depends on:** M0 repository reconciliation.\
**Enables:** [core setup](02-CORE-ONBOARDING.md) and [vehicle setup](03-VEHICLE-ONBOARDING.md).\
**Requirement coverage:** R01–R04, R09, R11.\
**Engineering defaults:** Autosave/resume, endpoint names and session schema below are proposals, not existing APIs.

## Outcome

One small reusable mechanism runs core and domain-specific onboarding. It supports a hybrid conversational/form interface, partial completion, explicit deferral, retries and normal application entry points. Onboarding is a UI and orchestration layer over existing business operations, not a second way to write unvalidated application state.

## Scope and non-goals

Implement a typed module registry and a shared shell. Avoid a workflow language, arbitrary graph editor, plugin marketplace or multi-user tenancy layer. Do not build native realtime voice streaming merely because planning happened in voice mode. Optional transcription or conversational assistance can use available capabilities; fields remain fully usable without them.

## Module contract

Use shared TypeScript/Zod definitions. A module declares:

```ts
// Illustrative contract; adapt names to repository conventions.
type OnboardingModule = {
  id: 'core' | 'vehicle';
  version: number;
  entryPoints: Array<'first_run' | 'settings' | 'add_asset' | 'asset_detail'>;
  steps: StepDefinition[];
  getCapabilities: (context: SafeContext) => CapabilityState;
  validateCompletion: (draft: unknown) => ValidationResult;
  buildPreview: (draft: unknown) => ChangePreview;
  commit: (draft: unknown, operation: CommitContext) => Promise<CommitReceipt>;
};
```

The deterministic step definition owns required fields and routing. A language model can propose field values, explain a question or propose a domain seed, but cannot decide that validation succeeded or activate tools on its own. Run interpreted answers through the same schemas as form submissions, show the proposed values, and let the user correct them.

## Persistence and state transitions

Add the smallest session store compatible with the existing database. Suggested fields:

| Field | Meaning |
|---|---|
| `id`, `module_id`, `module_version` | Stable session identity and the definition it uses |
| `subject_id` | Existing asset ID for enrichment; null for a new vehicle until commit |
| `parent_session_id` | Optional core session association; not ownership of the final asset |
| `status` | `in_progress`, `deferred`, `completed`, or `abandoned` |
| `current_step_id`, `step_states` | Stable step IDs and completion/skip states |
| `draft` | Validated, partial, non-secret answers plus source references |
| `revision` | Optimistic concurrency counter |
| `created_at`, `updated_at`, `completed_at` | Audit timestamps |
| `commit_operation_key`, `commit_receipt` | Idempotent finalisation identity and result |

A step can be `not_started`, `draft`, `confirmed`, or `skipped`. Unknown is usually an **answer state**, not a failed step. Keep `unknown`, `not_applicable`, `not_asked` and `deferred` distinguishable where useful; do not encode them as invented facts or zero values.

Transitions:

```text
new -> in_progress <-> deferred
in_progress -> completed
in_progress/deferred -> abandoned
completed -> normal entity editing or a new enrichment session
```

Completing core does not complete, discard, or block on a deferred vehicle child session. Abandoning a draft does not delete previously committed application records. Restarting setup is not a reset of settings, domains or vehicles.

## Save and commit behaviour

**Autosave:** Save non-secret draft changes after a short debounce and on step navigation. Show `Saving`, `Saved`, or `Not saved — retry`. A failed save keeps the current form and warns on navigation. Do not claim offline saving unless an actual durable offline mechanism is implemented and tested.

**Conflict:** Send the expected session revision. On a mismatch, return a typed conflict; preserve local input, fetch current values and offer reconciliation. A save finishing after more typing must not replace the newer text.

**Commit:** Review shows the actual changes: facts, readings, domain assignment, history entries, obligations, idea projects and document additions. Apply accepted changes through shared services and persist the commit receipt. A retry returns the same receipt, not duplicate assets or repeated task creation. Reusing an operation key with a different payload must fail clearly.

**Transaction boundary:** Perform deterministic validation before and during commit; never hold a DB transaction open while contacting a model or uploading a file. Create or update the asset, all accepted related database records and the completed-session receipt in one DB transaction. Extract transaction-aware commands from inline asset/domain/project/maintenance routes as needed; do not weaken atomicity to fit current route boundaries or make HTTP calls inside a transaction. Preserve asset → visit → ordered-item lock discipline, with a consistent session-lock order. Any asynchronous post-commit effects need durable retry state and must not rerun the committed entity writes.

**Preview and retry contract:** Flush pending autosaves before preview. Bind the reviewed change to session revision, a server-computed canonical payload fingerprint, and expected values/versions for every affected resource. Include lifecycle, domain, maintenance state, source associations and document versions, not only metadata. Completion revalidates these preconditions under locks. A stale preview requires a new review. Read an existing successful receipt before rejecting an old revision on retry; return it for the matching operation and reject changed content. Once a session completes, a different operation key cannot create a second entity from it.

**Session identity:** Use a client creation key to make start retries idempotent. An explicit Add another vehicle creates a new key; identity similarity never merges vehicles. Enforce one active or deferred enrichment session per module/existing subject using database uniqueness. Abandon, defer and resume require an expected revision; resuming cannot silently reset answers. Provide explicit lifecycle operations for abandon/resume in addition to the illustrative routes below.

Uploads are separate durable objects. Associate them with a draft first, then attach their references at commit. An upload failure must not claim attachment success; a metadata commit failure must not lose the original uploaded file. Provide deliberate cleanup for abandoned draft uploads without deleting shared references.

Core provider/settings changes are explicit immediate saves, not part of the final vehicle transaction. The shell must label this difference; Back or Abandon does not silently revert a saved provider configuration.

Core C3 similarly uses an explicit, previewed “Apply structure” operation with its own idempotent receipt. Child vehicle sessions reference the resulting stable domain IDs. Back/Abandon does not undo that labelled save, and core completion must not apply the seeds again.

## Entry points and navigation

Core starts after successful first-owner authentication, not through an unauthenticated administration endpoint. Existing installations can open setup from Settings without being forced through a full wizard.

Persist installation setup state separately from optional vehicle sessions. A fresh schema/bootstrap marks core setup eligible; the upgrade migration preserves existing owners as opt-in rather than forcing onboarding. Do not infer a fresh installation from missing sessions, number of domains, or AI availability. Completed and deferred core states have explicit re-entry behaviour and do not generate repeated setup banners for skipped capabilities.

The vehicle module is available from initial setup, the normal Add vehicle/asset path, and an existing asset's “Complete or update setup” action. Domain-launched entry can preselect that domain; it must still be editable.

Opening the same active session resumes it. Do not prohibit intentionally adding a second vehicle of the same year/model. For an existing asset, permit one active enrichment session per module/subject by default; conflicts must be visible rather than creating accidental clones.

The shell needs Back, Continue, Skip where allowed, Save and exit, and Resume. Show progressive detail without forcing people into permanent skill categories. Browser Back, keyboard navigation, mobile layout and focus on validation errors are acceptance concerns, not polish to defer indefinitely.

## Capabilities, not one “AI ready” flag

Expose separately: manual forms, text generation, structured interpretation, transcription, document extraction, external research, and active monitoring. State each as unavailable, configured, tested or degraded, with last successful test where applicable.

A missing capability removes or explains the relevant enhancement only. It does not remove ordinary fields, saved records, manual obligations or the ability to finish vehicle onboarding. A simple model ping is not a tool or research test.

## Proposed API surface

These routes are a starting contract, not claims about existing code. Reuse existing route conventions and services.

| Method and route | Behaviour |
|---|---|
| `GET /api/onboarding/modules` | Safe module and capability descriptions |
| `POST /api/onboarding/sessions` | Start or explicitly resume a matching session |
| `GET /api/onboarding/sessions/:id` | Load draft, revision and progress |
| `PATCH /api/onboarding/sessions/:id/steps/:stepId` | Validate and save non-secret draft changes with expected revision |
| `POST /api/onboarding/sessions/:id/preview` | Return deterministic proposed changes without applying them |
| `POST /api/onboarding/sessions/:id/complete` | Idempotent commit with operation key and expected revision |
| `POST /api/onboarding/sessions/:id/defer` | Save current progress and return to ordinary UI |

Only the owner can access setup and credentials. A later scoped agent may propose enrichment through its dedicated contract; do not give it unrestricted setup/session access by default. Derive audit actor from authentication, not an `actor` supplied by the caller.

## Implementation tasks

- [ ] Inspect existing settings, navigation, asset commands and shared schemas; write a reuse map.
- [ ] Add module and draft schemas, explicit unknown-answer handling and shared capability types.
- [ ] Add session persistence and migrations following the repository's triple-sync rule.
- [ ] Implement authenticated lifecycle endpoints, revision checks and operation receipts.
- [ ] Build the shared accessible shell with save status, resume and navigation protection.
- [ ] Add module-specific adapters that call the normal business services.
- [ ] Add safe optional conversation-to-draft interpretation with visible confirmation.
- [ ] Reconcile stale module versions on resume using an explicit migrator or a recoverable warning; never silently discard answers.
- [ ] Test fresh creation, existing installations, two tabs, duplicate submit and interrupted commits.

## Acceptance criteria

1. Refreshing or leaving a partially completed vehicle flow retains confirmed draft answers after a successful save.
2. A deferred vehicle module does not prevent core completion; it is independently resumable afterward.
3. Two tabs cannot silently overwrite each other's draft or entity changes.
4. Submitting completion twice creates exactly one asset and one set of related records.
5. A missing model or research worker does not disable manual setup.
6. New optional steps added in a later module version do not erase earlier progress or force completed users through onboarding again.
7. No API key, authentication token or provider secret appears in draft JSON, logs, conversation transcripts or exported documents.
8. The framework uses the normal maintenance, reading, document and task services; no parallel business rules are introduced.

## Verification and references

Use repository integration and component-test conventions from [S2 in the baseline](00-START-HERE.md#repository-baseline-and-sources). Regression-test the existing document editor's save-in-flight behaviour rather than recreating its previous race conditions. Shared release coverage is in [08](08-DELIVERY-AND-ACCEPTANCE-TESTS.md).
