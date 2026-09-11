# Implementation evidence and handoff

The agreed M1/M2/M3 programme is implemented on `codex/onboarding-vehicle-management`, originally based on `afc8aab6e91b880730e699f30daa6da001e70743`. For PR publication, the branch was advanced to merged `main` at `1fc307c51469984495629498973aa9a42eed9e46`; those base commits have identical file trees. The planning decisions in 00–09 remain authoritative. This file records implementation evidence separately from the earlier planning review.

The implementation is complete for the agreed handoff, with one explicit test exception: on 11 September 2026 the owner requested skipping the live Hermes test because they do not have Hermes available locally. M1's manual paths passed integration, upgrade, UI and build checks; the research/monitoring implementation and fresh Hermes package passed the checks recorded below. M2's live model/source/approval loop was **skipped, not passed**, and is no longer a completion blocker for this build task. Monitoring remains optional and paused until explicitly enabled; fixture results are not live worker acceptance.

## Package state

| Package | State | Evidence |
|---|---|---|
| P0 | Complete | Owner decisions D1–D4, contracts and base recorded in 00–09 |
| P1 | Implemented and verified | Encrypted managed secrets, redacted responses/errors, owner-only configuration, revision checks, candidate capability tests, explicit migration/rotation/restore tooling; 12 API settings cases and 2 UI cases |
| P2 | Implemented and verified | Durable sessions, autosave/CAS, defer/resume, exact preview and atomic receipts; 11 API framework and 5 shell UI cases |
| P3 | Implemented and verified | System-only fresh seeds, upgrade opt-in, C0–C6, immediate structure receipts, manual learning, real deferred child/domain path; 8 API core cases and browser walkthrough |
| P4a | Implemented and verified | Shared asset/domain/project/maintenance commands, typed vehicle conventions, existing provenance preservation; 7 focused cases plus regression suite |
| P4b | Implemented and verified | Private original retention, reviewed historical imports, reference-aware cleanup, normal source panel, minimized context and Markdown export; 8 source cases, 5 context cases, 5 private-download cases, 2 source UI cases and browser historical visit |
| P5 | Implemented and verified | Dated references/assessments, owner preview/apply, normal tracking, local future activation and restart catch-up independent of workers; 16 API knowledge cases and 9 UI cases |
| P6 | Implemented and verified | V0–V7, required identity only, independent preferences/units, exact projection through shared commands, atomic commit; 20 API cases and browser Prado walkthrough |
| P7 | Implemented and verified against fixtures | Worker-bound scopes, durable leases/retries, safe context, validated evidence, inert proposals, stale-safe owner application and audit receipts; 15 research API cases |
| P8a | Package implemented and verified | Fresh Hermes bootstrap and launch, pinned runtime, SOUL/AGENTS/skill/config/runbook, restricted fetch adapter; 16 Python cases including actual Hermes driver against local fixtures |
| P8b | UI/contracts implemented; live test skipped at owner's request | Owner research/token/approval UI has automated coverage. Real provider/public-source result and its approved application receipt remain unverified |
| P9 | Implemented and verified against fixtures | Optional scoped policies, shared fetch and individual assessment reviews, explicit coverage, bounded retry/catch-up, pause/lifecycle behavior, honest health and notifications; 12 focused monitoring API cases |

## Verification actually run

11 September 2026, local checkout:

For PR publication, each cumulative branch was checked independently in a clean temporary checkout with frozen dependencies. Database suites ran serially against the guarded local disposable databases.

| PR layer | API tests | Web tests | Typecheck | Production build |
|---|---|---|---|---|
| Safe settings | 139 passed | 5 passed | Passed | Passed, 46 static pages |
| Manual onboarding and vehicle management | 215 passed | 26 passed | Passed | Passed, 47 static pages |
| Research, Hermes and monitoring (full stack) | 242 passed | 32 passed | Passed | Passed, 48 static pages |

The full stack's 16 Python tests also passed using the actual pinned Hermes runtime against local model/source fixtures, including the native tool loop. No tests were skipped in that run. Builds emitted the existing `jose` Edge-runtime warnings for compression APIs imported by `session.ts`; that dependency and session module were unchanged. No image build or live deployment was performed locally. Documentation links, code fences and the complete committed diff's whitespace checks passed.

The Docker upgrade guide's migration-runner copy and status procedure was exercised inside the local development Postgres container against disposable `jeviops_test`. It found this branch's migration files and reported the intended database. No migration SQL was applied by that check; production Compose deployment remains an environment test.

Earlier implementation evidence:

- Baseline before feature edits: `pnpm test` passed 127 API and 3 web tests.
- Before PR publication, a full `pnpm test` passed **241 API tests and 32 web tests**. This included both clean bootstrap and populated upgrade assertions, all six vehicle commit rollback boundaries, and the updated knowledge preview/settings checks.
- A subsequent bounded-monitoring-report change was checked with `pnpm --filter @jevi-ops/api test test/monitoring.test.ts`: **12/12 passed**. The earlier full suite included 11 monitoring cases; do not describe the full run as containing the later extra case.
- `pnpm typecheck`: shared, API and web passed after the final source-link correction.
- `JEVI_NEXT_DIST_DIR=.next-validation pnpm build`: production build passed. The isolated output protects the owner's already running development `.next` directory. Production still defaults to `.next`.
- Production Compose configuration validation passed with synthetic validation-only environment values. The local development environment does not supply every production Compose input. No containers were created by that check; an image build/deployment was not performed.
- Bootstrap blocks 0054–0059 were checked against their migration files. The explicit 0054 fresh-install `eligible` versus populated-upgrade `opt_in` distinction is intentional.
- `git diff --check` passed.
- Hermes bootstrap/offline launch and its 16 Python tests were run by the delegated package builder. The actual pinned driver used a local streamed model/source fixture. Skill validation passed. No paid or real external model was used.

Database tests used guarded disposable databases `jeviops_test` and `jeviops_upgrade` on local Postgres port 54329. Database suites were serialized. None ran against the owner's development database. Tests and local sockets required approved sandbox escalation.

## Browser acceptance

A separate controller, `apps/api/scripts/onboarding-smoke.ts`, created an isolated database, test owner, authentication secret, private source directory and servers on ports 3300/3301. Its browser origin was `http://onboarding.localhost:3300`; it did not reuse the owner's localhost session or database. State is private and ignored under `.dev-run/onboarding-smoke/`.

The temporary servers and browser tabs were stopped after verification. The isolated fixture database and private state are retained for an optional future live test; the controller can restart them without affecting the owner's services.

Observed through the real UI:

1. Fresh authenticated setup entry and readiness; explicit manual mode; optional connections skipped.
2. Reviewed creation of the Vehicles domain. The child vehicle selected that real domain, was deferred, and remained resumable after core setup completed.
3. Resumed child with independent service-provider involvement, concise detail and active improvement interest. Saved the supplied 2015 Toyota Land Cruiser Prado TX, 87,600 km and NZ/NZ. The browser session labelled its own 11 September reading-date default; the deterministic F1 test covers the original fixed fixture. No fuel, engine, past service or legal obligation was invented.
4. Saved vehicle showed one reading, zero visits and zero tracked obligations before explicit manual additions. Structured preferences/coverage render as readable values and point to guided editing.
5. Retained a synthetic workshop source privately and entered a pending historical candidate. Retention/candidate creation alone did not create maintenance or a reading.
6. Created and reviewed a synthetic manual interval reminder with unknown applicability and a zero-day lead. The accepted record remained explicitly unchecked, with no invented last service baseline.
7. Reviewed the synthetic 1 August visit, 87,000 km and NZD150 invoice. One historical work line was accepted; the invoice total remained separate from unspecified allocated cost. The current reminder date and latest 87,600 km reading stayed unchanged. The source receipt opened the recorded visit through the existing vehicle visit route.
8. Vehicle page and research controls remained usable with no worker configured. No monitoring policy was enabled for the fixture.

Browser findings corrected during verification: skipped optional drafts affected completion; malformed legacy fields hid valid prefills; cleared optional identifiers failed validation; domain names were absent from displayed previews; a newly retained source was missing from the responsibility picker; displayed zero reminder lead fell back to 14; and source visit links used the wrong route. Earlier development hot refreshes interrupted transient test forms; the final manual workflow was rerun after source edits stopped.

## Acceptance map

| Acceptance rows | Evidence / remaining limit |
|---|---|
| T01–T03 | Core readiness/manual-mode tests, settings capability tests and browser fresh-owner flow |
| T04–T06, T36 | Settings redaction, credential binding, candidate tests, missing/wrong key and restore cases; authenticated reachability is distinct from actual transcription |
| T07–T10, T39, T41 | Core/framework CAS and retry cases, shell save/conflict cases, actual core/domain/deferred-child integration and browser flow |
| T11–T15 | Prado/minimal/miles fixtures, independent preference tests, skipped drafts and no invented history; browser supplied-facts review |
| T16, T37, T42 | Retained raw bytes, private/static-path checks, duplicate/uncertain history, explicit mixed-unit review, idempotency and browser historical import |
| T17–T19 | Existing document version/no-op/concurrency tests and editor tests. Reviewed existing restore-to-draft behavior and noninteractive Markdown checklist rendering; these do not invoke maintenance completion |
| T20–T22, T30, T44 | Manual policies, dated negative/unknown assessments, relevant-fact invalidation, exact preview and future local activation/cancellation/restart/settings-conflict tests |
| T23–T29 | Safe-context/privacy/snapshot tests; worker scope-denial, lease/idempotency, fabricated evidence, stale proposal and controlled application tests; P7/P8 UI cases. Live result approval belongs to the skipped portion of T45 |
| T31–T34 | Monitoring tests for shared evidence, separate assessment coverage, outages, preserved successful-check timestamps, bounded recovery, lifecycle pause and deduplication |
| T35 | Populated legacy owner/domain preservation and upgrade opt-in; separate clean bootstrap/system-only seed assertions |
| T38, T40 | Six real commit-only failure boundaries, receipt/related-record rollback, preserved source originals and successful identical retry; lifecycle/domain/document/item/context precondition checks |
| T45 | Fresh pinned Hermes installation and actual runtime/skill/tool loading passed; **real model/public-source/owner-approval loop skipped at owner's request; unverified** |

## Live Hermes test skipped by owner

The owner explicitly requested skipping this test on 11 September 2026 because they do not have Hermes available locally. No model endpoint or credential is required to close the current build task. The local application uses a loopback mock model; the prepared worker installation has only offline-check configuration and no model credential.

A concrete [deferred live acceptance case](11-LIVE-WORKER-ACCEPTANCE.md) defines the bounded question, disposable asset, stale attempt, fresh approval and required evidence. The packaged fetcher successfully read its official Consumer Protection HTML source without a model or credentials. This only verifies source access; the live model and approval flow remains unverified.

If the owner chooses to run it later:

- Configure a fresh installation using `workers/hermes/README.md`, the pinned runtime and a dedicated restricted test-worker token. Keep the Jevi token and model credential separate.
- Run a bounded request on the disposable test vehicle against an explicitly allowed primary-source HTML/text page. Retain the actual sources, content hashes and literal excerpts.
- Review the resulting supported change, exercise stale refusal, approve the current preview on the test asset and record the application receipt. Revoke the temporary worker token after verification.
- Record actual runtime/adapter, question, job/result/proposal IDs and source/application evidence here. Only then mark the live check as passed. Deterministic mocks and offline health do not establish live integration success.

## Migration and operational handoff

New migrations are 0053–0059: safe settings, onboarding, private sources, vehicle knowledge, historical evidence, scoped research and monitoring. They are included in the populated upgrade runner, clean bootstrap and Drizzle schemas. Existing deployments must apply pending migrations; do not baseline an unknown database. Fresh installs run the full schema and system seed before baselining.

Provision private source storage outside public uploads, include it with database backups, and configure the external versioned settings keyring before migrating legacy dashboard-held credentials. See `docs/SETTINGS-CREDENTIALS.md`. The API image now includes migration metadata and the Hermes setup package; Compose mounts private evidence separately.

Local accepted future transitions and monitoring run through the API scheduler, with bounded startup catch-up. Manual future activation does not require a worker. Research capabilities remain separate from text generation and transcription. The packaged Hermes adapter supports permitted public HTML/text fetches, not general browsing, PDF extraction or arbitrary tools.

The owner subsequently requested GitHub PRs to review and test on the host where Hermes is available. The implementation is organized into the three cumulative branches documented in [PR review and environment testing](12-PR-REVIEW-AND-ENVIRONMENT-TEST.md). The top branch contains the full application; the local live-test waiver does not imply that the owner's environment test has passed.

No feature migrations were applied to the owner's development database. No live owner credentials were rotated, no live vehicle was changed, and nothing was deployed by this work. The unrelated pre-existing review documents remain local and are excluded from the PRs.
