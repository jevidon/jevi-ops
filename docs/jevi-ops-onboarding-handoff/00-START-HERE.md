# Jevi Ops — onboarding and vehicle-management implementation handoff

**Prepared:** 8 September 2026\
**Repository:** `jevidon/jevi-ops`\
**Purpose:** Turn the voice-planning discussion into separable, buildable workstreams.\
**Status:** Implementation delivered in the working tree; see [10 — Implementation evidence and handoff](10-IMPLEMENTATION-STATUS.md) for verification and deployment notes. The owner requested skipping the live Hermes acceptance test on 11 September 2026; live integration remains unverified.

**Reviewed locally:** 11 September 2026. See [09 — Implementation readiness review](09-IMPLEMENTATION-READINESS-REVIEW.md) for repository evidence, confirmed decisions and contract corrections. This review updates the plan; it does not start feature implementation.

## Start here

Build an onboarding system that gets a single-user installation into useful operation, plus a reusable vehicle-onboarding module. Jevi Ops must remain useful without an external agent: people can enter records, define maintenance and compliance reminders, and manage uncertainty themselves. A separately integrated agent can research, propose updates, and monitor changes, but must not become a prerequisite for creating or using a vehicle record.

Read this file and the relevant workstream before changing code. Follow the repository's `CLAUDE.md`. Reconcile the plan against the checked-out branch before inventing tables, routes, or services.

## Handoff files

| File | Responsibility | Principal deliverable |
|---|---|---|
| [01 — Onboarding framework](01-ONBOARDING-FRAMEWORK.md) | Shared sessions, steps, resume, module entry points and commit semantics | One reusable, deterministic onboarding mechanism |
| [02 — Core onboarding](02-CORE-ONBOARDING.md) | Installation handoff, model provider, credentials, integrations, initial domains and learning the interface | Fresh install → useful workspace |
| [03 — Vehicle onboarding](03-VEHICLE-ONBOARDING.md) | Screen-by-screen vehicle journey and progressive detail | Add or enrich a vehicle during setup or later |
| [04 — Vehicle records and Markdown](04-VEHICLE-RECORDS-AND-MARKDOWN.md) | Facts, readings, history, source documents and agent-readable context | Durable, traceable records without competing sources of truth |
| [05 — Compliance and manual management](05-COMPLIANCE-AND-MANUAL-MANAGEMENT.md) | Jurisdiction, applicability, unknowns and user-managed obligations | Useful compliance tracking without research capability |
| [06 — External agent integration](06-EXTERNAL-AGENT-INTEGRATION.md) | Capability discovery, research jobs, results, proposals, authentication and approval | One real end-to-end external research integration |
| [07 — Proactive vehicle management](07-PROACTIVE-VEHICLE-MANAGEMENT.md) | Scheduled reviews, regulatory changes, staleness and re-evaluation | Optional, observable ongoing management |
| [08 — Delivery and acceptance tests](08-DELIVERY-AND-ACCEPTANCE-TESTS.md) | Build order, regression coverage, fixtures and release gates | A testable sequence of small deliveries |
| [09 — Implementation readiness review](09-IMPLEMENTATION-READINESS-REVIEW.md) | Current checkout reconciliation and decision record | Evidence and closure conditions before implementation |
| [10 — Implementation evidence and handoff](10-IMPLEMENTATION-STATUS.md) | Delivered packages, checks actually run and owner-approved test exception | Current implementation status and migration notes |
| [11 — Deferred live worker acceptance](11-LIVE-WORKER-ACCEPTANCE.md) | Prepared live test, skipped at the owner's request | Optional future verification when a worker/model is available |
| [12 — PR review and environment test](12-PR-REVIEW-AND-ENVIRONMENT-TEST.md) | Published branch stack, migration order and setup on the Hermes host | Review and test the complete application before merging |

## Confirmed requirements from the discussion

| ID | Requirement |
|---|---|
| R01 | Single-user installation; multi-user administration is out of scope. |
| R02 | Core onboarding covers system readiness, LLM configuration and API keys, optional integrations, initial domains/areas, and how to use the system. |
| R03 | A blend of conversation and ordinary dropdown/text fields is acceptable. |
| R04 | Vehicle onboarding is the same module whether launched during initial setup or independently later. It can be deferred. |
| R05 | Establish how the person wants help: routine service reminders, DIY involvement, learning/detail preferences, and upgrades/build plans. These are independent preferences, not rigid user classes. |
| R06 | Present year, make, model and trim as the core vehicle identity fields. |
| R07 | Current odometer is optional and has a kilometres/miles selector independent of jurisdiction. |
| R08 | Capture where the vehicle is based and where it is registered; handle jurisdiction-specific information. |
| R09 | Support no history, partial history, and extensive maintenance records. Unknown information is valid, not an onboarding failure. |
| R10 | Distinguish existing vehicle state and installed changes from proposed future work. |
| R11 | Missing regulatory information or an absent agent must not block onboarding. Users can manually define and update obligations. |
| R12 | Retain vehicle-specific Markdown/reference information that an agent can use later. |
| R13 | Keep durable records and controlled state changes in Jevi Ops; external research and active discovery can be delegated. |
| R14 | Process regulatory changes supplied by the user or found through proactive research; retain evidence and update affected records through a controlled path. |
| R15 | Automatic vehicle enrichment is not a mandatory first-release dependency. |

The confirmed worked example is **2015 Toyota Land Cruiser Prado TX**, **87,600 km**, based in **New Zealand**, registered in **New Zealand**. Other attributes are not established by that example. Do not infer the engine, fuel, VIN, service history, or legal obligations from the trim name.

## Proposed implementation defaults, not additional user decisions

Proceed with these defaults unless the checked-out code provides a better compatible solution. Record material deviations in the implementation PR; do not interrupt development for cosmetic choices.

| Decision | Default | Boundary |
|---|---|---|
| Saving progress | Server-backed autosave, explicit resume and defer | Discussed but not explicitly answered by the user; do not call it an agreed requirement. |
| Minimum identity | Year, make and model required to finish this vehicle wizard; trim offers “Not sure” | Trim remains a first-screen field. Generic asset creation need not become stricter. |
| AI unavailable | Core can finish in clearly labelled manual mode | AI-dependent features are unavailable, not reported as healthy. |
| Setup commit | Vehicle data is previewed, then committed through normal services; provider settings have explicit immediate saves | No hidden partially active maintenance schedules from unconfirmed drafts. |
| External writes | Agent findings become proposals; consequential changes require owner approval | An authenticated manual edit uses the normal save/confirmation path. |
| Research scheduling | Off until enabled and connected to a capable worker | No promise of monitoring from a stored preference alone. |
| Initial implementation scope | Connect existing model services; do not deploy models or open provider accounts | Automated model installation would be separate work. |
| Markdown | Preserve authored Markdown as durable narrative; operational facts keep their authoritative typed stores | No background regeneration that destroys authored knowledge; no new two-way filesystem sync in this work. |

## Architectural boundaries

**Jevi Ops owns:** authenticated setup, durable records, document versions, operational schedules, tasks, review queues, approvals, audit history, and the deterministic application of accepted changes.

**A configured model provider supplies:** language interpretation or generation. A working chat connection does not demonstrate browsing, reliable tool execution, document extraction, or proactive research.

**An external harness owns:** allowed external searches/fetches, research execution and tool/network limits. The owner selected a new Hermes installation for the first adapter. Jevi Ops owns review scheduling; a working Hermes/browser integration must still be built and tested.

**Manual users can:** create or correct facts, upload reference material, record known service history, define obligations and schedules, and supply regulatory changes. None of this depends on a research worker.

“Passive state owner” does not mean removing the existing maintenance sweep or reminders. Deterministic scheduling from accepted records stays in Jevi Ops; discovering new external facts is the separate concern.

## Repository baseline and sources

The inspection for this handoff covered the repository README, selected source files, and recent PR descriptions. It was not a full diff review, a deployment check, or a test run.

The recent working stack was open through **PR #45**, with head **`c19193b76304c1bf147bed85527d5f52e4e74594`**, branch **`feat/maintenance-review-fixes-2`**. The retrieved PR descriptions state that #45 is stacked on #44 and that the earlier sequence begins with #37. Open PR content must not be mistaken for merged `main` or the deployed application. The building agent must verify the current integration branch and ancestor chain; do not merge or cherry-pick this stack blindly.

| Source | What was verified or reported | Implementation consequence |
|---|---|---|
| [S1 — README](https://github.com/jevidon/jevi-ops/blob/c19193b76304c1bf147bed85527d5f52e4e74594/README.md) | Fastify/TypeScript API, Next.js web, shared Zod types, Postgres/Drizzle, settings and API tokens | Extend this stack; do not introduce SQLite as a replacement. |
| [S2 — CLAUDE.md](https://github.com/jevidon/jevi-ops/blob/c19193b76304c1bf147bed85527d5f52e4e74594/CLAUDE.md) | Migration triple-sync, development controller, disposable DB tests and web tests | Follow the actual migration and verification workflow. |
| [S3 — LLM adapter](https://github.com/jevidon/jevi-ops/blob/c19193b76304c1bf147bed85527d5f52e4e74594/apps/api/src/lib/llm.ts) | OpenAI-compatible and Anthropic adapters; tool definitions/results already supported | Earlier conversational wording that implied no tool-call support was too broad. Research orchestration is the capability to establish. |
| [S4 — Settings routes](https://github.com/jevidon/jevi-ops/blob/c19193b76304c1bf147bed85527d5f52e4e74594/apps/api/src/routes/settings.ts) | Existing app settings, integration inventory, LLM and STT tests; app settings currently return stored keys | Reuse services, but implement safe secret handling and honest capability tests before reusing responses in onboarding. |
| [S5 — Maintenance routes](https://github.com/jevidon/jevi-ops/blob/c19193b76304c1bf147bed85527d5f52e4e74594/apps/api/src/routes/maintenance.ts) | Asset routes are in this module, including an asset context bundle, reading paths, facts compare-and-set and shared maintenance services | Do not create a parallel vehicle datastore or second maintenance engine. |
| [S6 — Document service](https://github.com/jevidon/jevi-ops/blob/c19193b76304c1bf147bed85527d5f52e4e74594/apps/api/src/lib/docs.ts) | `doc_md`, required expected versions, conflicts, no-op saves and revision history | Reuse `saveDoc`; automated edits never silently force an overwrite. |
| [S7 — PR #41](https://github.com/jevidon/jevi-ops/pull/41), [#43](https://github.com/jevidon/jevi-ops/pull/43) | PR descriptions: assets act as areas through domain assignment; overview documents, idea projects and gallery support | Do not create duplicate “area” or vehicle-document concepts. |
| [S8 — PR #40](https://github.com/jevidon/jevi-ops/pull/40), [#42](https://github.com/jevidon/jevi-ops/pull/42), [#44](https://github.com/jevidon/jevi-ops/pull/44), [#45](https://github.com/jevidon/jevi-ops/pull/45) | PR descriptions: obligation policies, historical evidence rules, service visits, retry/concurrency fixes, currency handling | Preserve these invariants and independently run their regression tests. Reported test counts are not independent verification. |

Earlier user-library plans, `IMPLEMENTATION-PLAN.md` (Hermes Personal Operating System, proposed v0.1, “Storage Architecture”) and `UpdatedSpec.md` (“Librarian Wiki Contract”), describe Markdown as the durable human knowledge layer and a separate operational database. They concern the wider Hermes system. Preserve that knowledge/operations separation, but do **not** transplant their SQLite recommendation into this Postgres repository. External wiki synchronization remains a separate integration decision.

No current NZ or US regulation was researched for this handoff. Regulatory examples are requirements and synthetic test scenarios, not an authoritative list of obligations, rates, deadlines, or announced legislation.

## Delivery milestones

1. **M0 — Reconcile the base and contracts.** Verify the active branch, existing services and migrations. Establish field ownership, session semantics and secret boundaries.
2. **M1 — Useful without agency.** Deliver framework, core setup, vehicle setup, Markdown/context, source retention and manual compliance. This is the first independently releasable slice.
3. **M2 — On-demand research works end to end.** Deliver a real external adapter, sourced proposal, user review and safe application. A mock worker alone does not satisfy this milestone.
4. **M3 — Optional ongoing management.** Add scheduled reviews, change detection, affected-vehicle re-evaluation and visible failures. Keep manual operation intact.

M2 and M3 are explicit planned requirements, not gaps to hide behind “future agent support.” They simply do not gate M1 or a user's onboarding completion.

**Implementation acceptance update, 11 September 2026:** The owner requested skipping the live Hermes test because they do not have Hermes available locally. All implementation workstreams remain delivered; the real-model/source/approval portion of M2/T45 is excluded from this handoff's completion requirements. Its skipped status is not evidence that live research or monitoring works. The prepared test remains available in 11 for a later configured installation.

## Owner decisions from the implementation-readiness review

Confirmed on 11 September 2026:

- Use the current checkout, `fix/parser-latency` at `afc8aab6e91b880730e699f30daa6da001e70743`, as the implementation base. It includes the pinned baseline above and migrations through 0052. Create a separate implementation branch when coding begins; do not silently retarget older `main`.
- New installations seed only required system records, then let the owner choose domains. Preserve existing installations. Original-owner example domains belong in explicit demo/test data.
- Approval of an exact future-dated change authorises activation at the appropriate time after local precondition checks. Changed or insufficient preconditions require review; they do not authorise a different change. This local transition mechanism belongs in M1 and does not depend on a worker.
- No existing Hermes worker is available. The owner selected a new Hermes agent installation. M2 includes creating the files and integration needed to instantiate it: agent instructions, skills, configuration templates, startup documentation, and a real executable integration. Instruction files alone do not satisfy M2.
- After implementation and offline verification, skip the live Hermes acceptance test for this handoff. Do not require local model/worker configuration to close this build task, and do not report the skipped test as passed.

The review found existing `projects.kind = 'area'` alongside assets acting as areas. Preserve both existing concepts, explain their uses, and avoid creating both for the same vehicle. It also confirmed that typed free-text capture requires a model; manual-mode teaching uses ordinary create forms.

## Instruction to the building agent

> Read `00-START-HERE.md` and `08-DELIVERY-AND-ACCEPTANCE-TESTS.md`, then the workstream you are implementing. Verify the current branch and existing contracts against the pinned baseline. Produce a concise mapping of reuse points, new migrations, API changes and tests before coding, then proceed with reasonable defaults. Keep the existing maintenance and document invariants intact. Do not require a model, browser, VIN, odometer, full history or known compliance state to create a useful vehicle record. Do not implement external regulatory research as unsourced model text. Finish each PR with changed behaviour, migration notes, tests actually run, remaining limitations and the next dependency. Do not claim an external worker or monitor works until an end-to-end check demonstrates it.
