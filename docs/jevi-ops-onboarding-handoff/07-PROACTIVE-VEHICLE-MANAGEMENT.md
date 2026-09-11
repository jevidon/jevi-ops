# 07 — Proactive vehicle management and regulatory change monitoring

**Depends on:** [05 — Compliance knowledge](05-COMPLIANCE-AND-MANUAL-MANAGEMENT.md) and a working [06 — External integration](06-EXTERNAL-AGENT-INTEGRATION.md).\
**Requirement coverage:** R13, R14, with R11 preserved.\
**Release:** M3; opt-in at runtime.\
**Outcome:** Accepted vehicle knowledge can be reviewed and updated when the world changes, without confusing monitoring with a guarantee of compliance.

## Product boundary

Jevi Ops continues to own accepted records and deterministic reminders. The external worker performs scheduled discovery or receives appropriate update signals. An enabled monitor checks for changes; it does not authorise new obligations, purchases, payments, external messages or government submissions.

Manual user-supplied updates must enter the same evidence/review model even when no worker exists. Scheduled monitoring is an enhancement over manual management, not a new prerequisite.

## What can trigger a review?

Support these explicit trigger classes:

| Trigger | Example | Handling |
|---|---|---|
| Scheduled knowledge review | A known applicability assessment reaches its review date | Request a fresh check, including prior negative assessments |
| Relevant source change | An official notice or source revision appears | Assess its status, scope and affected vehicles |
| User report | The owner adds a notice/link or describes a change | Retain as an unverified observation or process as a confirmed manual edit |
| Vehicle fact change | Registration jurisdiction, powertrain/class or other relevant attribute changes | Invalidate affected assessments and request/recommend re-evaluation |
| Worker recovery | Monitoring has been unavailable past the intended interval | Perform a bounded catch-up check, not hundreds of duplicate jobs |

An odometer update can change ordinary maintenance urgency without requiring a new web research job. Keep local deterministic events separate from external knowledge discovery.

## Monitoring policy

Store a policy ID, scope, included vehicles/jurisdictions/rule categories, whether enabled, review cadence, notification preference, allowed source scope, request budget and applicable approval policy.

A proposed starting cadence is monthly for low-volume regulatory review, configurable by the owner and not a promise to discover every change immediately. Higher-frequency checks can be used for an already-known approaching effective date. Do not hard-code this cadence as a user-approved decision.

Monitor shared jurisdiction/class rules once where possible, then evaluate the affected vehicles individually. Do not make the same public search once per vehicle when the underlying source is identical. Conversely, do not assume two vehicles in the same household share applicability just because they share a country.

Jevi Ops is the scheduling owner: it persists policy and due-review jobs while the new Hermes worker claims and executes them. Do not enable a second Hermes review schedule for the same policy. Polling for work does not itself authorise or create a scheduled research request.

## Change detection pipeline

```text
source fetch or authorised update signal
  -> retained source observation with timestamps/version/hash
  -> determine whether the substantive rule changed
  -> classify status: discussion/proposal, enacted future rule, effective rule,
     superseded rule, or unresolved
  -> match potentially affected vehicles and required facts
  -> compare with each accepted applicability assessment
  -> create a reviewable proposal or an explicit no-change/insufficient-evidence result
  -> owner approval/manual confirmation
  -> apply and reconcile operational tracking
  -> retain history and schedule the next meaningful review
```

A changed page hash is only a signal: navigation, formatting and publication metadata can change without a rule change. Model interpretation must point to supporting content. A failed fetch must not count as a successful review. Conflicting sources require a visible unresolved result, not a silently chosen convenient answer.

Re-evaluate **not-applicable** assessments as well as active obligations. Otherwise a newly introduced rule will never be discovered for a vehicle previously outside its scope.

## Rule status and future effective dates

Publication, retrieval and legal effectiveness are distinct. A proposal should be displayed as a watch item, not an active charge. An enacted rule with a future date may justify a preparatory task, but that task must be labelled separately from a currently effective obligation.

Store rule versions and the assessment's evidence basis. Reuse the accepted-future-transition mechanism delivered in M1/P5: approval covers the exact future operation, which is applied locally only after precondition checks. M3 adds discovery and re-evaluation, not a second activation mechanism. If the source is unclear or the vehicle facts are insufficient, keep the obligation unresolved rather than guessing.

Use version references to invalidate dependent assessments when a rule changes. Preserve the superseded assessment, sources and any completed work. Removing an old assessment from the current view is not permission to delete its history.

## Worked change scenario

Use the NZ petrol-vehicle road-use charging example only as a **hypothetical requirement**. No policy status or commencement date is asserted here.

The scenario succeeds when:

1. A vehicle has a dated, sourced or explicitly user-reported negative applicability assessment.
2. A user or worker supplies evidence of a possible change.
3. The system distinguishes a proposal from a confirmed current/future rule.
4. The worker or owner identifies the exact required vehicle attributes and does not infer missing fuel/class information.
5. A proposal explains which assessment would change, when, and what tracking would result.
6. Approval updates the assessment and relevant schedule through the same manual-management services.
7. The previous negative assessment remains inspectable, and repeated observations do not create repeated obligations.

A second vehicle may remain unaffected or unresolved. Batch summaries must show that difference.

## Operator visibility

Show these concepts separately:

- **Connection:** Worker configured, reachable or unavailable.
- **Monitoring policy:** Enabled or paused, with scope and cadence.
- **Last successful relevant check:** Actual completed review, not a heartbeat or attempt.
- **Latest outcome:** No supported change, pending proposal, missing facts, or failure.
- **Next intended check:** A schedule, not a guarantee.

Do not show “All rules up to date” based on a generic heartbeat. If a policy is enabled but no worker can execute it, say “Monitoring unavailable” and show the last successful check. Manual tracking and existing deterministic reminders continue.

Notify about meaningful changes, approaching accepted transitions and sustained failures. Deduplicate notifications by source/rule version and affected assessment. No-change checks should normally be quiet. Unknowns can be reviewed in a knowledge queue without generating a daily alarm for every missing field.

## Failure, lifecycle and recovery

Bound retries and use backoff. Keep the previous accepted assessment but mark freshness honestly when checks fail. Do not advance `last_checked_at` for a timeout, blocked source or unsupported result.

Pause monitoring for stored/sold/archived assets according to the owner's policy, defaulting to no new active management of sold/archived vehicles. Preserve history. A lifecycle transition should reconcile jobs and notifications without deleting already accepted evidence.

On worker reconnection, coalesce missed checks into a current review. Replayed jobs and result callbacks must be idempotent. Rejected proposals are retained and should not reappear unchanged unless new evidence or materially changed circumstances justify reconsideration.

## Implementation tasks

- [ ] Add opt-in monitoring policies and a single authoritative scheduling owner.
- [ ] Add shared rule/source review deduplication and affected-asset matching.
- [ ] Reuse research jobs and proposals for scheduled and user-supplied triggers.
- [ ] Track substantive changes separately from page hash changes.
- [ ] Implement negative-assessment re-evaluation and future-effective transition handling.
- [ ] Add honest health/freshness/outcome UI and actionable failure states.
- [ ] Add lifecycle pause, bounded catch-up and notification deduplication.
- [ ] Test proposed-to-effective transitions, unknown vehicle facts, source failures and multiple affected vehicles.

## Acceptance criteria

A previously negative assessment can become a reviewed positive assessment after a supported rule change. A proposed or future-effective rule is never activated early. The system does not claim monitoring is working without successful relevant checks. Source failures do not refresh knowledge timestamps. One shared rule change produces distinct, correct per-vehicle outcomes without duplicate jobs/tasks. Manual edits and existing reminders continue when monitoring is paused or disconnected.
