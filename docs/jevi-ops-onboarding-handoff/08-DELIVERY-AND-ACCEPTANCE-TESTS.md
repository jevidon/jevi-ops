# 08 — Delivery sequence, fixtures and acceptance tests

**Purpose:** Coordinate the workstreams without conflicting schema changes or weakening existing maintenance behaviour.\
**Status:** Proposed implementation and test plan. The repository test suite was not executed when preparing these files.

**Review update, 11 September 2026:** The owner confirmed the current checkout as the base, system-only fresh seeds, pre-approved future activation after local precondition checks, and a new Hermes installation with worker setup files included in M2. See 00 and 09. Local `pnpm typecheck` passed during the review; integration tests and build remain implementation gates.

**Implementation acceptance update, 11 September 2026:** Package delivery and verification are recorded in [10](10-IMPLEMENTATION-STATUS.md). The owner requested skipping the live Hermes test because it is unavailable locally. This explicitly waives the real-model/source/approval portion of M2/T45 for completion of the current build task. Offline/runtime, fixture, application and migration checks remain recorded separately; live integration is unverified.

## Phase zero: reconcile before writing code

The handoff inspected selected files at PR #45 head `c19193b76304c1bf147bed85527d5f52e4e74594`. It did not verify the deployed app. Recent PR descriptions indicated an open stack beginning at #37 and continuing through #45. See the [source/baseline record](00-START-HERE.md#repository-baseline-and-sources).

The building agent must identify the actual target branch, current HEAD, incorporated PRs and latest migration. Read `CLAUDE.md`; inspect existing shared schemas, settings/auth, asset/maintenance services, document versioning, action/proposal facilities, tool registrations and source-upload support.

Produce a short checkpoint containing:

- Existing code to reuse and concrete extension points.
- New persistence and API contracts, separated from existing ones.
- A mapping for vehicle facts, authored Markdown and operational state.
- Secret storage and worker-permission changes, including legacy-route bypass checks.
- Migration numbers allocated against the actual branch, plus tests and release boundaries.

The review checkpoint is recorded in 09 and the concrete contracts have been incorporated into 01–07. Start from the owner-confirmed `afc8aab` checkout contents, checking for intervening changes before coding. Do not re-platform storage, build an unrestricted agent or reopen already confirmed single-user/optional-information requirements. Escalate genuine incompatible contracts with their implementation consequence.

## Suggested PR-sized sequence

Labels below are work-package IDs, not actual GitHub PR numbers.

| Package | Scope | Dependencies | Exit evidence |
|---|---|---|---|
| P0 | Baseline and contract checkpoint | None | Current branch, existing invariants, migration plan and field ownership recorded |
| P1 | Safe settings, encrypted credential migration/recovery and provider/integration tests | P0 | Redacted GET/PATCH/errors; owner-only credential operations; revisioned configuration; tested/degraded states; old Settings UI still works |
| P2 | Installation setup state, session framework and shared shell | P0 | Fresh/upgrade handling; resume/defer/abandon; session uniqueness, preview/precondition and receipt contracts |
| P3 | System-only fresh bootstrap, explicit seed application and manual learning flow | P1, P2; P6 for final C4 wiring | Fresh-owner/manual-mode paths usable; existing domains preserved; child vehicle uses committed domain IDs |
| P4a | Typed vehicle profile and transaction-aware shared asset/domain/project commands | P0 | Existing ownership preserved; new field conventions validated; no parallel business rules |
| P4b | Private source artifacts, manual candidates/imports, Markdown/context/export | P4a, P2 session contract | Sources outside public uploads; authenticated retrieval; reference-safe cleanup; versioned narrative and idempotent manual imports |
| P5 | Manual compliance, knowledge state and local accepted-future transitions | P0, P4a/P4b contracts | Manual obligations and future activation work with no worker; dated applicability and existing policy integration |
| P6 | Vehicle screens and integrated reviewed commit | P2, P4, P5 | Exact Prado example, minimal path, standalone launch and existing-vehicle enrichment pass |
| P7 | Scoped worker auth and durable research contracts | P1, P4, P5 | Restricted context, job leases, result validation and no generic-route bypass |
| P8a | Fresh Hermes worker package and real polling adapter | P7 | Pinned runtime, profile/config/instruction/skill files, bootstrap/runbook and working claim/result transport |
| P8b | Owner review UI, controlled apply and real-worker acceptance | P8a, P7 | Fresh worker instantiated; sourced research → owner approval → test asset updated with receipt |
| P9 | Monitoring, affected-vehicle review and visible health | P8 | Scheduled/manual triggers, future changes, failures and deduplication pass |

P4 means both P4a and P4b; P8 means both P8a and P8b. P1, P2 and P4a can proceed independently after P0. P3 can land its core-only path before P6, with C4 wiring completed during integration. One owner must coordinate shared Zod types, schema changes and migration numbering. The vehicle UI may be developed against agreed fixtures while services land, but it cannot be considered complete against mocks alone.

M1 ends after P1–P6 integration. M2 requires P7–P8; its live adapter smoke test is skipped for this handoff under the owner's acceptance update above. M3 requires P9. All implementation workstreams remain in scope.

## Migration and compatibility rules

Every database change must land in all three repository representations: `infrastructure/migrations/NNNN_*.sql`, `infrastructure/schema-selfhost.sql`, and `apps/api/src/db/schema.ts`. Update shared schemas and API callers in the same delivery where contracts change. Do not preallocate numbers from this dated handoff; active branches may have added migrations.

Test both a clean install and an upgrade from a populated prior schema. Add migrations to the repository's upgrade-path test. Existing assets, documents, source associations, schedules and annotated tasks must survive the upgrade.

Do not baseline an unknown database merely to silence migration errors. Follow the repository's explicit fresh-install versus existing-database procedure. Plan rollback through backward-compatible readers and feature disabling where possible; never drop user data just to undo a UI release.

Feature-gate optional research and extraction during rollout. A disabled worker must not break asset pages or manual maintenance. Re-running setup is not a migration/reset mechanism and must not reseed the owner's organisation automatically.

## Test fixtures

The examples below are logical test inputs, not existing API payloads. Map them through the shared draft schemas. Keep real user facts separate from synthetic policy data.

### F1 — Exact confirmed Prado input

```json
{
  "fixture_id": "prado-confirmed-input",
  "identity": {
    "year": 2015,
    "make": "Toyota",
    "model": "Land Cruiser Prado",
    "trim": "TX"
  },
  "reading": {
    "value": 87600,
    "unit": "km",
    "observed_on": "2026-09-08",
    "date_basis": "onboarding_today_default"
  },
  "jurisdiction": {
    "based_country": "NZ",
    "registration_country": "NZ"
  },
  "history_coverage": "not_asked",
  "fuel_powertrain": null,
  "engine": null,
  "vin": null,
  "regulatory_applicability": "unknown"
}
```

Expected: preserve exactly the spoken identity, distance and countries. The reading date is an explicitly labelled default from the session day, not separately spoken evidence. No engine, fuel, VIN, past service, legal rule or maintenance baseline is inferred.

### F2 — Minimal manual owner

Year, make and model only; trim unknown, reading absent, jurisdiction unknown, no records supplied, no model and no worker. Expected: finish vehicle setup, create one usable asset and no invented services or obligations.

### F3 — Unit independent of country

Synthetic vehicle based and registered in NZ; owner explicitly selects `mi` and enters `54000`. Expected: retain miles. Changing country cannot reinterpret it. Once a reading is committed, respect the existing unit-lock rule.

### F4 — Outsourced maintenance plus active upgrades

Owner uses a workshop for all maintenance, wants concise explanations, has detailed receipts and is actively planning accessories. Expected: preserve all independent preferences, permit detailed history and ideas, and do not label them a DIY mechanic or hide build planning.

### F5 — Partial and conflicting history

Two copies of one invoice, one month-only service date, one conflicting reading and a multi-line visit with an invoice total different from allocated line costs. Expected: preserve originals, deduplicate cautiously, review uncertain candidates, retain currency, and commit only supported events through normal services.

### F6 — Synthetic future rule change

```json
{
  "fixture_id": "synthetic-rule-change-not-real-law",
  "synthetic": true,
  "rule_id": "test-only-distance-charge",
  "jurisdiction": "NZ",
  "publisher": "TEST FIXTURE - not a real authority",
  "initial_assessment": "not_applicable",
  "requires_vehicle_facts": ["fuel_powertrain", "registration_class"],
  "versions": [
    {"version": 1, "status": "proposal", "effective_from": null},
    {"version": 2, "status": "enacted_future", "effective_from": "2099-01-01"}
  ]
}
```

Freeze the test clock before and after the synthetic effective date. Use fake source artifacts, never a live legal claim. Expected: a proposal does not activate an obligation; a future rule remains future; missing vehicle facts produce uncertainty; accepted applicable changes activate only under the agreed effective-date semantics. Another vehicle can remain unaffected. The date is not a policy prediction.

The agreed semantics are approval now for the exact future transition, then local revalidation at the effective instant. Supply an explicit timezone for the synthetic date-only fixture. Test changed facts, cancelled/superseded transitions, restart catch-up and repeated processing with no worker. These local activation assertions are P5/M1 gates; external discovery of changes is P9/M3.

## Cross-workstream acceptance matrix

| Test | Scenario | Required outcome | Primary plan |
|---|---|---|---|
| T01 | Fresh installation and first-owner handoff | Secure sign-in and actionable readiness; no unauthenticated admin bootstrap | 02 |
| T02 | Provider missing/unavailable | Explicit manual mode; fields and manual records still usable | 01, 02 |
| T03 | Text-only model lacks tools/structured output | Text capability shown accurately; no false research-ready status | 02, 06 |
| T04 | Settings GET, errors, logs and exported drafts | No raw credentials or secret-bearing URLs exposed | 01, 02 |
| T05 | Change provider/endpoint or credential source | No old key sent to a new host; clear versus environment fallback is explicit | 02 |
| T06 | STT endpoint returns 401/403 | Reachability is not misreported as authenticated transcription readiness | 02 |
| T07 | Core seed retry/rerun | No duplicate domains/assets, no unintended rename or merge | 02 |
| T08 | Defer child vehicle setup and complete core | Core completes; child session remains resumable independently | 01, 03 |
| T09 | Refresh, save failure, two tabs or typing during save | No lost answers; visible unsaved/conflict status; new edits preserved | 01 |
| T10 | Completion double-click, timeout/retry or changed payload/key | Exactly one commit, or a typed conflict; no duplicated records | 01, 03 |
| T11 | Exact Prado fixture F1 | Correct identity, 87,600 km and NZ/NZ; no inferred fuel/history/law | 03, 04 |
| T12 | Minimal owner fixture F2 | Setup completes without optional facts or an agent | 03, 05 |
| T13 | Miles in NZ fixture F3 | Unit choice retained; no silent reinterpretation after jurisdiction change | 03, 04 |
| T14 | Outsourced enthusiast fixture F4 | Maintenance involvement, detail and upgrade interest remain independent | 03 |
| T15 | No records supplied | Unknown history, not an invented completion/baseline at today's reading | 03, 04 |
| T16 | Partial/duplicate history fixture F5 | Raw sources retained; ambiguous candidates reviewed; accepted imports idempotent | 04 |
| T17 | Structured update while narrative is edited | Facts and authored Markdown preserved; expected-version conflict enforced | 04 |
| T18 | Initial document, no-op save, revision restore | No initial text loss; no-op creates no spurious revision; restore remains reviewable | 04 |
| T19 | Markdown checklist tick | Does not complete a real maintenance item or task | 04 |
| T20 | Manual interval/expiry/prepaid obligation with no worker | Normal policy/evidence semantics and editable source basis | 05 |
| T21 | Unknown or stale negative applicability | Not shown as verified exemption or legal compliance | 05, 07 |
| T22 | Jurisdiction or relevant class/fuel correction | Dependent assessments flagged for review; history preserved | 05, 07 |
| T23 | Worker reads safe context | Allowed vehicle data only; no settings secrets or unrelated household data | 04, 06 |
| T24 | Proposal-only token calls generic write/approve/token routes | Access denied server-side; no bypass through old routes | 06 |
| T25 | Source content tells agent to ignore approval | Treated as untrusted data; no permission or canonical-state change | 06 |
| T26 | Fabricated citation, malformed result, insufficient evidence | Rejected or explicitly unresolved; no canonical update | 06 |
| T27 | Worker result repeated, lease expires or callback arrives late | Idempotent receipts, bounded retries and visible status | 06 |
| T28 | Facts/documents change before proposal approval | Re-evaluation/conflict, not silent overwrite or forced save | 06 |
| T29 | Owner approves supported proposal | Existing services apply changes and record evidence, actor and receipt | 06 |
| T30 | Synthetic proposal/future/effective rule fixture F6 | No early obligation; correct version, date and per-vehicle applicability | 05, 07 |
| T31 | Failed source fetch or worker outage | Last successful check unchanged; honest unavailable/stale status | 07 |
| T32 | Shared rule affects several vehicles | One source review, distinct assessments and no duplicate tracking | 07 |
| T33 | Sold/archived vehicle or disabled monitor | New monitoring pauses per policy; records/history preserved | 07 |
| T34 | Worker reconnects after missed checks | Bounded catch-up, no repeated equivalent proposals/notifications | 07 |
| T35 | Fresh seed versus populated upgrade | Only system records on a new install; existing domains retained; upgrade owner not forced into setup | 01, 02 |
| T36 | Settings PATCH/error and wrong/missing encryption key | No raw secrets; visible degraded capability; no silent credential fallback; restore tested | 02 |
| T37 | Private source requested through public static path | Unavailable via `/uploads/`; authorised source retrieval still works | 04 |
| T38 | Failure at each stage of vehicle commit | No partial related records or completed receipt; original uploads retained for retry | 01, 03 |
| T39 | Retry with changed completion key or payload | Completed session cannot create another vehicle; mismatched payload conflicts | 01 |
| T40 | Lifecycle/domain/item changes after preview | New review required; no stale entity overwrite or schedule effect | 01, 03 |
| T41 | Deferred child after structure application/core completion | Child retains real domain references; rerun does not duplicate seeds | 01, 02 |
| T42 | Mixed-unit historical source | Original amount/unit retained; explicit conversion review before ledger entry | 03, 04 |
| T43 | Manual learning with no model | Ordinary create forms work; free-text parser not advertised as manual capture | 02 |
| T44 | Approved future transition with worker off | Correct local activation, precondition conflict, cancellation and restart idempotency | 05 |
| T45 | Fresh Hermes worker from package | Intended profile/instructions/skills loaded; restricted tools/credentials; actual source-backed loop works | 06 |

## Existing regressions that must remain green

The recent maintenance PRs report fixes that onboarding/imports must not circumvent. Independently verify them against the branch:

- Retrying an old maintenance completion is a read, not permission to close the next occurrence.
- An expiry renewal without the new expiry is refused; ticking a generated task cannot bypass evidence requirements.
- Backdated history does not move a newer pinned schedule or close current work.
- Pausing, rescheduling or changing lifecycle preserves annotated tasks according to existing reconciliation rules.
- A service visit shares one date/reading; line edits cannot corrupt that shared fact, and undo/corrections preserve consistency.
- Reading changes use temporal-neighbour/decrease checks and the authoritative latest-reading query.
- Metadata compare-and-set preserves unrelated keys and provenance; document saves preserve initial revisions and in-flight edits.
- Attachment operations do not lose concurrent removals/hero selections; onboarding source additions do not regress the gallery.
- Invoice totals, allocated costs, unpriced work and foreign currencies remain distinct.

## How to verify and report

Use the repository's documented test runner and development controller. Confirm that database tests target disposable test databases and never a production host. The documented runner derives test configuration from the development environment; inspect it before executing destructive setup. Do not rerun the user-creation script against the live owner's account merely to establish a test login.

At minimum, run `pnpm test`, `pnpm typecheck` and `pnpm build` from the repository root following `CLAUDE.md`, including its warning about building beside a running development server. Run targeted API and component tests for each PR, plus the populated upgrade test for migrations. Record the actual command, target environment and pass/failure output; do not copy test counts from old PR descriptions.

Keep regulatory behaviour tests deterministic using synthetic sources and fixed clocks. The separately prepared real-worker smoke test is skipped at the owner's request for this handoff. If performed later, record the adapter/version, question, sources, proposal and application receipt. Do not use a live changing website as a fragile unit-test fixture.

## Final release gates

**M1:** A new or existing single owner can complete core and standalone vehicle setup, including F1/F2, with research disabled. Manual history, source retention, narrative documents and manually defined obligations work. Secrets are protected and migration/regression checks pass.

**M2:** The delivered package instantiates a new Hermes worker on a pinned/tested runtime and completes an on-demand sourced research loop; the owner can inspect and approve a stale-safe change on a test asset. Profile/instruction/skill loading, token scopes, provenance, idempotency and no-agent fallback are enforced. Templates alone do not pass this gate.

For this implementation handoff, the owner has waived the live portion of that original M2 gate. Record it as skipped, retain the package/runtime/fixture evidence, and do not claim the original live gate passed. The waiver does not change runtime capability checks or enable monitoring.

**M3:** Enabled monitoring performs observable reviews, revisits old negative assessments, handles future-effective changes and shows failures honestly. Manual operation remains intact.

Each PR handoff should state what changed, what existing code was reused, migrations required, tests actually run, assumptions adopted, limitations and the next dependency. UI placeholders, fake capability badges and mock-only agent results do not satisfy a completed milestone.
