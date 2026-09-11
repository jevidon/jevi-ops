# 05 — Jurisdiction, compliance knowledge and manual management

**Depends on:** Existing maintenance policies plus the record contract in [04](04-VEHICLE-RECORDS-AND-MARKDOWN.md).\
**Requirement coverage:** R08, R09, R11, R13, R14.\
**Release:** Manual management is part of M1. Research and monitoring consume the same records later.\
**Important:** This is a software plan, not current legal guidance. No country-specific rates, legal intervals or policy dates are established here.

## Outcome

A user can record known responsibilities, define their own reminders, state uncertainty and update information later. Selecting a country does not magically establish the law. An absent research worker must never prevent saving a vehicle or manually managing an obligation.

Separate three questions:

1. **What rule or responsibility is being described?** A sourced rule version, a service recommendation or a user-created reminder.
2. **Does it apply to this vehicle, and on what evidence?** A dated applicability assessment.
3. **What should the app track or do?** An accepted operational maintenance item/schedule.

Do not treat a reminder as proof of a legal obligation, or a completed reminder as proof of legal compliance.

## Reuse the maintenance engine

The recent stack provides `interval`, `expiry`, `prepaid_meter` and `on_condition` policies. It also separates due urgency from data confidence and enforces completion evidence. Reuse these rather than introducing a second compliance scheduler. See [S5 and S8](00-START-HERE.md#repository-baseline-and-sources).

| Tracking need | Existing policy to reuse | Evidence to retain |
|---|---|---|
| Repeating service or user-defined interval | `interval` | Supplied interval and actual baseline/completion evidence |
| Issued expiry or renewal date | `expiry` | The actual new expiry, not an invented period added to payment date |
| Purchased distance entitlement | `prepaid_meter` | Purchased-to reading, unit and supporting source |
| Inspection with a finding and review point | `on_condition` | Finding and next review information |

These are scheduling shapes, not assertions about what a particular jurisdiction requires. An obligation whose shape does not fit must remain descriptive/pending until explicitly supported; do not force a calendar recurrence onto a distance-based rule.

## Minimum durable knowledge model

Implement the smallest typed representation that supports manual entry and later versioned research. Prefer extending/reusing existing provenance or proposal stores; do not build a universal legal rules engine.

### Responsibility or rule reference

Store an ID, user-facing title, kind (`user_reminder`, `service_recommendation`, or `regulatory`), jurisdiction/scope when known, source records and version identity. Manual entries can have no official rule reference. A self-authored source note is valid evidence of what the user entered, but must not be labelled an authoritative legal source.

A shared regulatory rule should have one versioned reference used by multiple affected vehicles, not disconnected Markdown copies per car. Store public source observations and accepted rule versions separately where needed so unreviewed findings do not immediately become canonical operational policy.

### Applicability assessment

Record asset ID, rule/responsibility reference, assessment result, relevant vehicle facts, rationale, evidence/source IDs, who assessed it, when it was checked, and when it next needs review.

Use separate dimensions rather than an ambiguous boolean:

- Applicability: `unknown`, `applicable`, or `not_applicable`.
- Evidence basis: `user_reported`, `document_supported`, or `official_source_supported`.
- Review state: `unreviewed`, `accepted`, or `needs_review`.
- Freshness: derived from last meaningful check/review policy; not the same as record modification time.

`not_applicable` is a dated assessment, not a permanent exemption. `unknown` is never displayed as “not required.” An unchecked screen is not a negative assessment.

### Operational link

Link accepted tracking to the existing maintenance item ID and preserve its source/reference. Avoid a second table with another due date or completion flag for the same responsibility. Pending research can exist without creating an active obligation or immediate overdue task.

A known responsibility with insufficient baseline data may use the existing confidence states, but the UI must not confuse “missing evidence” with “overdue.” Deliberately added manual reminders can operate while legal applicability remains unknown, clearly labelled as user-created tracking.

## Time and change semantics

Keep these distinct when applicable:

| Time | Meaning |
|---|---|
| `published_at` | When the source published the information |
| `retrieved_at` | When research fetched or received it |
| `effective_from` / `effective_until` | When the rule version is in force, if established |
| `assessed_at` | When applicability to this vehicle was considered |
| `last_checked_at` | Last successful substantive check, not just an attempted run |
| `review_due_at` | Next intended review of the knowledge |

Dates can be unknown; do not fabricate them. A later retrieval timestamp does not make an older proposal into current law. A future-effective rule does not create a present legal obligation early. A source being unavailable does not extend the freshness of the previous finding.

When facts that affect applicability change—such as registration jurisdiction or a confirmed powertrain/class correction—mark dependent assessments for review. Preserve the old decision and its context rather than silently rewriting history.

### Accepted future transitions — part of M1

The owner confirmed that approval now authorises the exact future transition, conditional on a later precondition check. Implement this in Jevi Ops's deterministic scheduler independently of research availability.

Persist the accepted operation, evidence/rule version, affected asset/item IDs, expected relevant facts and record versions, effective instant and time basis, approval actor/time, status and idempotent application receipt. States are `pending`, `applied`, `needs_review`, `cancelled` or `superseded`. Record changes and corrections as history. Store exact effective timestamps when supported by the source; a date-only rule requires an explicitly recorded jurisdiction timezone before automatic activation. Do not silently use the server's timezone. If the effective time cannot be established, retain pending knowledge for review without automatic activation.

When due, lock and recheck the accepted transition and affected records, confirm lifecycle permits activation, and apply the exact accepted operations through normal services in one transaction with the receipt. Changed facts, schedule state, superseded evidence or missing information produce `needs_review`, never an inferred replacement. No worker or new network fetch is required to apply an already supported and accepted transition. If its evidence has become unresolved, stop for review.

Restart catch-up processes outstanding due transitions once. Cancellation, manual edits and activation races must be deterministic and auditable. Preparatory reminders remain distinct from effective obligations. P9 may discover new changes but must reuse this mechanism rather than introducing another activation scheduler.

## Manual UX and workflow

From the vehicle onboarding and normal asset page, expose **Add a responsibility/reminder**, **Record known details**, **Mark as unknown**, and **Update existing information**.

The manual form asks for a name, kind, optional applicability statement, relevant dates/distance/policy, source note or attachment, and an optional review date. The form adapts to the tracking policy. Country may change terminology/examples; it does not supply unverified legal defaults.

An authenticated owner can save their own information through the normal confirmation path. Do not require them to manufacture a research report or wait for an agent approval. Show “Entered by you” and source details. For a change that will reschedule or retire live tasks, preview those effects before confirmation.

Provide a visible knowledge status alongside schedule status, for example: “User-entered expiry; not independently researched” or “Applicability not established.” Never show a blanket green “legally compliant” badge from incomplete data.

Support a future user-supplied regulatory update as a document/link/note. Without an agent, the user can describe and confirm changes manually. With a worker, the same source can be sent for investigation and become a reviewed proposal. A pasted link alone is not a verified change.

## Research gaps and task creation

Store an unresolved gap such as “Determine applicable recurring responsibilities for this vehicle” without claiming that research is running. The user can leave it as a visible gap, create a manual follow-up task, or request external research when available.

Use a stable source reference for generated follow-up work so repeated visits to onboarding do not create duplicate tasks. Do not flood the task list with a new overdue item for every unknown field. Keep knowledge follow-ups separate from actual renewal/service completion tasks.

## RUC change scenario from the discussion

The requirement is that an assessment made today must be revisitable if rules later change. The user's example concerned possible petrol-vehicle road-use charging in New Zealand. This document does not confirm the present legal position, a future policy, a rate, or an implementation date.

The implementation must support this sequence:

```text
an existing, dated “not applicable” assessment
  -> a user report or external source observation about a possible change
  -> verification of rule status and any effective date
  -> re-evaluation against the specific vehicle's known facts
  -> an explicit proposal or manual edit with a change preview
  -> accepted assessment and corresponding tracking changes
  -> retained prior assessment and sources
```

If fuel/class is unknown, the output is “need this fact to assess applicability,” not an inferred exemption or charge. If the change is only proposed, retain it as a watch item and do not activate a payable obligation. If a future rule is accepted, distinguish preparation/review reminders from the actual effective obligation.

## APIs and application path

Reuse normal maintenance creation/edit/completion for operational records. Add narrow knowledge/assessment services only for missing concepts. Both manual and agent-approved writes must converge on those services.

When a manual or approved change affects facts, an assessment and a tracking item together, validate the complete operation and preserve transactional consistency. Do not append a new legal statement to Markdown while leaving the linked schedule in contradictory state. Record before/after values, actor, sources and the reason for change.

Changing an obligation must preserve annotated tasks, prior completion evidence and service-visit relationships according to the existing reconciliation rules. Disabling or superseding a rule is not authority to delete history.

## Implementation tasks

- [ ] Map responsibility kinds, knowledge state and applicability onto the existing model; add only missing typed persistence.
- [ ] Introduce shared versioned rule/source references without building a general-purpose legal rules engine.
- [ ] Build manual forms and unknown/defer paths into onboarding and the normal asset page.
- [ ] Link accepted tracking to existing maintenance policies and evidence validators.
- [ ] Add knowledge-gap presentation and idempotent optional follow-up task creation.
- [ ] Implement jurisdiction/fact-change invalidation, assessment history and change previews.
- [ ] Ensure future-effective and proposed rules cannot become active obligations prematurely.
- [ ] Add manual update tests with the model and research worker both disconnected.

## Acceptance criteria

Unknown compliance information never blocks onboarding. A user can define an expiry, interval or prepaid-distance item manually and later correct it. Unknown is never converted to not-applicable, and an old negative assessment becomes reviewable when relevant facts or rules change. A reminder carries its actual source basis. Proposed/future changes stay distinct from current obligations. All tracking reuses the existing maintenance engine, with no duplicate tasks or loss of history.
