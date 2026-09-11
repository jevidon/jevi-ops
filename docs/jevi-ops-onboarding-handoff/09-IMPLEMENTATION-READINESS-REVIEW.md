# Implementation readiness review — 11 September 2026

**Final verdict: the revised plan is ready to begin implementation from the agreed base.** The initial review found unresolved decisions and contracts. The owner answered the material questions, and their decisions plus the contract corrections are now incorporated into 00–08. No blocking product or architecture question remains from this review. This is planning readiness, not evidence that unbuilt features or migrations pass their acceptance tests.

The review covered all nine original handoff files and relevant local implementation, schemas, installation seeds, authentication, uploads, capture, and test infrastructure. The handoff documents were revised and this review added. No application code, database, credentials, deployment, or Git branches were changed. Feature implementation has not started.

## Verified baseline

- Checkout: `fix/parser-latency`, HEAD `afc8aab6e91b880730e699f30daa6da001e70743`.
- The pinned handoff baseline `c19193b76304c1bf147bed85527d5f52e4e74594` is an ancestor. The only subsequent commit is the parser latency fix. The local checkout therefore contains the maintenance, document, service-visit, and currency foundations referenced by the handoff.
- Latest migration: `0052_currency_visit_outcomes.sql`. `0053` is locally unused, but allocate migration numbers only after the implementation base is agreed and refreshed.
- Local `main` and the cached `origin/main` reference point to `dccbcf2`, before the maintenance stack. Live GitHub merge status and deployment state were not checked. Do not interpret cached references as current remote status.
- The handoff folder and three earlier review documents were already untracked. Their existing contents were left unchanged.
- `pnpm typecheck` passed for shared, API, and web packages. Integration tests and production build were not run in this planning review; runtime correctness and upgrade success remain unverified.

## Confirmed owner decisions

| ID | Decision | Confirmed outcome | Applies to |
|---|---|---|---|
| D1 | Which integration base should implementation target? | Current checkout at `afc8aab`, retaining the prerequisite stack. | All implementation |
| D2 | What should a genuinely new installation seed? | Required system records only, then owner-selected domains; preserve existing installations. | P3 installation work |
| D3 | Does approval of a future-dated change authorise later activation? | Yes: apply the exact accepted transition after local precondition rechecks; stop for review if they changed. | P5/M1 effective-date contract |
| D4 | Which real worker will satisfy M2? | A new Hermes installation. Build the requisite agent instructions, skills, configuration and startup files plus the real adapter; no existing worker is assumed. | P8a/P8b; does not block M1 |

These questions were surfaced and answered in the review conversation. Autosave, optional odometer/history, manual mode, single-user scope, Postgres, and Markdown ownership were already sufficiently specified and were not reopened. Remaining host/model/credential values are deployment inputs; the builder must pin and test the actual Hermes version before M2 acceptance. No secret needs to be supplied in the plan.

## Review findings and their planned resolutions

The findings below explain why the original plan needed revision. Their resolutions are now requirements in 00–08; they describe work to implement, not fixes already made to the application.

### 1. Fresh-install seeding contradicts the personalised setup journey

Plan 02 C3 presents owner-selected domains, but [seed.sql](../../infrastructure/seed.sql) inserts nine original-owner domains, including Hill Media Group and Tech With Jerad. The documented installation runs that seed before first sign-in. A wizard that merely adds the owner's selections would start with unrelated organisation and potentially associated observation rules.

D2 is resolved: the seed/install/test-fixture change is explicitly scoped in 02/P3. Preserve the fixed Inbox identity and required singleton records. Do not remove existing domains by recognising their names: an owner may have legitimately retained or edited them.

Also specify first-run detection. The authenticated layout currently has no setup state, and adding a session table alone cannot distinguish a fresh install from an upgraded owner with no onboarding session. Proposed contract: persistent installation setup state; upgrades with existing owners remain opt-in; fresh installs receive the setup entry; completed/deferred setup has deterministic re-entry. Do not use domain count or AI availability as the detector.

### 2. Reviewed commit guarantees need a concrete contract, not a conditional transaction

The original Plan 01 promised an exact preview and no duplicates, but qualified the new-vehicle transaction with “where existing service boundaries allow it.” That qualification has been removed. [Asset create/edit](../../apps/api/src/routes/maintenance.ts) and domain/project creation contain inline route logic. Existing transaction helpers, readings, documents, and visits are reusable, but a complete onboarding command does not exist.

Before P2/P6, make atomicity mandatory for the accepted asset, related database records, and completion receipt. Extract the route operations into transaction-aware commands. Upload bytes remain outside this transaction. Define deterministic post-commit reconciliation and recovery for any effects that cannot be committed with it.

Freeze these details:

- Completion binds the session revision, canonical payload fingerprint, accepted preview, and relevant entity preconditions. A changed payload with the same key conflicts; a retry after success returns the original receipt even though the session is now completed.
- A completed session cannot create another vehicle through a fresh operation key. Starting/resuming a new-vehicle session must distinguish an intentional second vehicle from a retried creation request.
- Existing-asset enrichment checks every affected resource, including lifecycle, domain assignment, maintenance state, source associations, and document versions. Metadata compare-and-set alone does not protect those other fields; its existing `expected` value is optional, so onboarding must require it where applicable.
- Preserve the existing asset → visit → ordered-item lock discipline. Acquire the onboarding session lock consistently and use deterministic ordering for any multi-asset operation.
- Choose domain-seed commit timing. Recommended: an explicit C3 “Apply structure” operation with its own receipt, so the child vehicle can reference real domain IDs; abandoning core setup does not undo that clearly labelled save.

### 3. Credential protection is a real M1 dependency with a migration and recovery cost

[Settings routes](../../apps/api/src/routes/settings.ts) return raw keys on GET and PATCH, accept ordinary API-token authentication, and test the active global model configuration. [LLM resolution](../../apps/api/src/lib/llm.ts) uses nullable per-field overrides with environment fallback. The handoff correctly identifies these starting problems; it has not chosen the concrete replacement or its operational lifecycle.

The adopted P1 contract separates internal resolved settings from the redacted public response; uses session-only credential/configuration mutation and endpoint tests; defines explicit keep/replace/clear/use-environment credential operations and provider/endpoint binding; and tests candidates through the runtime resolver without changing active settings. Redact PATCH and error responses as well as GET. Migrate every existing Settings caller together.

For dashboard-held secrets, a reasonable implementation default is authenticated encryption with a dedicated versioned key supplied outside Postgres. Document provisioning, plaintext migration, backup/restore, rotation, and missing/wrong-key behaviour. A missing key must fail the affected capability visibly, without silently selecting a different provider credential. This is an engineering proposal, not evidence that encryption already exists or a request to paste a key into this conversation.

Fine-grained worker scopes can remain P7, but P1/P2 must enforce their owner-only boundaries immediately. Add P1 as a dependency of P7: a restricted context endpoint is insufficient if the same token can still use generic settings or write routes.

### 4. Private sources need a separate storage and association design

Plan 04 correctly requests authenticated source retrieval. The existing [upload route](../../apps/api/src/routes/uploads.ts) handles images, while [server registration](../../apps/api/src/server.ts) serves the entire uploads directory at `/uploads/` without an authentication hook. Putting private receipts below that root and adding a second authenticated endpoint would leave the static path accessible.

The adopted P4 contract uses source bytes outside the public image root; opaque source IDs; authenticated retrieval through a web/API path compatible with the application's session handling; source-to-session and source-to-asset associations; separate import candidates and acceptance receipts. Preserve the photo gallery contract. Use a deliberate file-type/size allowlist, content validation, and reference-aware cleanup for abandoned drafts. Do not fetch a pasted external URL automatically in the manual-only release.

Source retention, manual candidate entry, and duplicate review belong in M1. Automated extraction stays optional; its absence must not make the manual pipeline a placeholder. This package is substantial enough to split into profile/command work and private-source/import work.

### 5. Effective-date behaviour straddles M1 and M3

The original Plan 05 made manual responsibility management and future-rule safety part of M1, while Plan 07 placed future activation and precondition revalidation inside M3, dependent on a working research integration. F6 referred to “agreed effective-date semantics” before those semantics had been agreed.

D3 is resolved as approval-now/activation-later. The durable pending transition, local due processing, timezone/effective-instant rule, changed-precondition conflict, lifecycle handling, restart catch-up, and idempotent receipt now belong in 05/P5. P9 schedules research and supplies new proposals, reusing the local activation service.

Activation must work without a worker. No future rule becomes an active maintenance obligation simply because its record was saved.

### 6. Several repository concepts need explicit field and UX mappings

The revised 04 records the shared field mapping for P4/P5/P6 implementation:

| Logical value | Existing authority / proposed extension |
|---|---|
| Vehicle identity | Existing `assets.id`, `name`, `kind`; metadata `year`, `make`, `model`; map wizard trim to existing `variant`, avoiding a second independent `trim` value. |
| Vehicle identifiers | Retain existing `vin` and `plate`; add distinct typed chassis/model-code keys without repurposing generic serial identifiers. |
| Jurisdiction and preferences | Add named typed metadata conventions and explicit unknown/coverage states; keep free-text `location` compatible. Retain provenance and unknown existing keys. |
| Current reading | Existing ledger plus authoritative latest-reading query. Unit is currently on the asset, not each reading row. Lock it after any reading exists; there is no implemented unit-conversion endpoint. Preserve original mixed-unit import evidence and require explicit conversion/review before accepting a ledger value. |
| Narrative | Existing `doc_md`, `doc_version`, `saveDoc`, and revision history. Generated snapshots remain separate. |
| Responsibility knowledge | New versioned references, assessments, and links to existing maintenance items; no duplicate operational due date or completion flag. |
| General areas | The repository also has `projects.kind = 'area'`, exposed by the Capture grid. Explain general areas separately from a vehicle asset acting as an area; do not create both records for one vehicle or retire the existing area concept implicitly. |

For manual-mode C5, use the existing create-type links and ordinary forms. The typed free-text capture box calls the same model-dependent pipeline as voice; “typed” does not mean “works without AI.” Add this distinction to the learning flow and acceptance tests.

### 7. M2 needs a new worker package as well as an adapter

The local tree has model tool support and internal search/read tools. Inspection did not find the proposed durable research jobs, proposal approvals, scoped worker permissions, or a Hermes adapter. A tool-capable model connection is therefore not an implementation substitute for P7/P8.

D4 is resolved: build a new Hermes worker package and polling adapter under P8a, then complete owner review/application and end-to-end acceptance under P8b. Plan 06 now lists the profile/configuration templates, `SOUL.md`, workspace `AGENTS.md`, `skills/jevi-vehicle-research/SKILL.md`, supporting contracts, bootstrap/start/stop/health tooling, and runbook. The real smoke test uses a dedicated test vehicle and a concrete reviewed change, without silently modifying the owner's live vehicle.

Official [Hermes profile documentation](https://hermes-agent.nousresearch.com/docs/user-guide/profiles/) and [skill documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/) were checked for the package conventions. Plan 06 also records that profile/instruction files do not enforce isolation and that launch-path instruction loading must be tested. Jevi Ops owns scheduling; a second independent Hermes research schedule is excluded.

## Delivery corrections and P0 closure

Keep M1/M2/M3. Amend the package boundaries as follows:

| Package | Required clarification |
|---|---|
| P0 | D1–D4 and contract corrections are recorded in 00–08. Recheck for intervening repository changes before coding. |
| P1 | Include credential migration/recovery, existing callers, owner-only access, candidate configuration, capability tests, and settings concurrency. |
| P2 | Define lifecycle, session uniqueness, explicit abandon/resume semantics, autosave flush before preview, and receipt/precondition rules. Entity commit tests complete only once real module commands are available. |
| P3 | Include bootstrap/seed reconciliation and manual learning. Core can land without vehicle wiring, but C4's integrated acceptance depends on P6. |
| P4a/P4b | Typed profile/shared commands and private sources/manual import/context/export are separate packages. Both must land for M1. |
| P5 | Implement knowledge services and the chosen local effective-date behaviour. Reuse maintenance policies. |
| P6 | Integrate real commands, child-session/domain linking, preview, atomic commit, and existing-vehicle conflict handling. |
| P7 | Depend on P1 plus P4/P5, and audit legacy-route scope bypasses. |
| P8a/P8b | Build the new Hermes setup package and adapter, then require a real sourced proposal/application smoke test. |
| P9 | Own scheduled discovery, shared-source deduplication, affected-vehicle reviews, and health; reuse local transition application from P5. |

Add explicit tests beyond T01–T34 for: system-only fresh seed versus populated upgrade; first-run detection; raw-secret exclusion from PATCH/errors; wrong encryption key and restore; private-source static-path bypass; failed commit at each related-record boundary; retries with a different completion key; changed lifecycle/domain/item between preview and commit; deferred child referring to core-created domains; mixed-unit historical sources; manual learning with no model; and effective transition processing with the worker disabled.

The planning checkpoint is closed: decisions and contracts above are incorporated into 00–08, including corrected dependencies and T35–T45. Implementation can begin in the agreed sequence, with migration numbers allocated against the then-current branch. Runtime tests, populated upgrade checks, build, and fresh Hermes worker acceptance remain explicit implementation gates. This review stops before feature implementation, as requested.
