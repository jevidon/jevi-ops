# Configurable task workflows and purchase tracking

Updated 17 September 2026 · task/subtask scope confirmed by Jevi

Implementation: first delivery is implemented on `codex/configurable-list-statuses`. Purchase tracking and Shopping remain the next delivery. Migration 0054 has been exercised in disposable databases, not applied to the installed database.

## 1. Product decision

The user uses **primary tasks and subtasks** in projects, areas and domains. Project checklists are not the target. This supersedes the earlier checklist-first recommendation.

Keep ordinary checkboxes by default. Each project or area can opt into named task statuses. A domain can configure its directly held tasks; projects and areas within it opt in independently. Enabling one grocery project must not change other projects in the food domain.

Examples:

- Everyday groceries: **Need to buy ↔ Have enough** on reusable tasks.
- Emergency kit: **Need to buy → Need to pack → Packed**, with manual moves backward after use.
- Renovation: ordinary task checkboxes, with one or two individual purchase tasks appearing in a future Shopping view.
- Battery inspection: a maintenance obligation generates an action while the kit item remains Packed.

The offline capture/native iOS effort is separate. Local transcription, attachments, ESP32 transfer and device queues belong to the separate capture plan. PR #51 is merged; task workflows can proceed independently.

## 2. First delivery: custom statuses on tasks and subtasks

### Status semantics

Keep `tasks.status` as Open / Waiting / Done for existing filters, reminders, summaries, maintenance and clients. Add `workflow_status_id` for the selected local stage. Each custom status declares one category:

| Category | Meaning | Example labels |
|---|---|---|
| Open | Actionable work remains | Need to buy, Need to pack |
| Waiting | Blocked or awaiting someone | Ordered, Awaiting delivery |
| Done | Satisfied for now | Have enough, Packed |

No label must be called Done. A workflow need not contain a Done category at all. It does require an Open category so new and reopened tasks have a destination. The first status in each category is its default; ordering does not define an automatic transition.

A status marked Done participates in existing completion counts and views. This is explicit in the editor. Recurring tasks retain their existing behavior: entering Done rolls the due date forward and returns the task to the default Open stage. A reusable grocery item with manual need tracking should not be given an ordinary recurrence rule merely to retain it.

### Scope and subtasks

- Projects and areas share the project configuration mechanism.
- Tasks without a project use their domain's configuration.
- There is no implicit inheritance from a domain into its projects.
- Subtasks use their own project/domain routing, as ordinary tasks do. The existing subtask creator assigns the parent's routing.
- Moving a task keeps its canonical category and selects the destination's default for that category. It does not carry a foreign status ID into the new workflow.
- Moving a parent does not introduce a new cascade that moves all its subtasks.

### Existing data and clients

Enabling custom mode preserves current categories and completion timestamps, mapping tasks to the first applicable custom status. If the workflow has no status for an existing category, the task retains that category with its standard label until the user chooses a custom stage. Disabling custom mode clears the custom selections and preserves the canonical categories.

Legacy clients can continue writing Open / Waiting / Done. A canonical category change resets the custom selection to the new category's default; it cannot later resurrect an obsolete stage. Direct database writers used by voice and maintenance get the same normalization through the task trigger.

Selecting a different label within the same category does not complete a task again, restart recurrence or reset its waiting anchor. Maintenance tasks retain the existing evidence requirement and transactional completion behavior.

### Presets and editing

Presets are available across the app, with Groceries and Kit readiness included. They are JSON templates copied into local settings. Local editing does not update a saved preset or another project. Save a modified setup as another preset when it should be reused.

No preset subscription, version adoption or mapping-preview framework. Local settings use a revision number only to reject stale edits. Removing or changing the category of an occupied status is refused until tasks are moved out. Renaming is allowed. Deleting a preset does not affect its copies. Replacing a workflow follows the same occupancy rules.

### Web surfaces

Use the status selector in task rows, task detail, subtasks, the task ledger, and the actionable briefing rows. Ordinary tasks retain their existing checkbox controls. Configured project and domain views keep satisfied items available for reuse. Waiting subtasks must remain visible. Older native/widget/voice clients keep their canonical category contract; rich custom-status controls for those clients are a later integration.

### Storage and concurrency

- `projects.task_workflow` and `stewardship_domains.task_workflow`: local JSON definitions.
- `workflow_revision` on each scope: optimistic editing, not preset versioning.
- `tasks.workflow_status_id`: selected local stage.
- `task_workflow_presets`: global saved templates.
- Additive migration `0054_task_workflows.sql`, mirrored in the self-host schema and Drizzle.

Configuration changes briefly serialize with task writers while checking occupancy and assigning defaults. Task status changes validate the scope revision, selected ID and category in a transaction. The trigger normalizes all writers. No generic workflow engine or second scheduler is introduced.

## 3. Second delivery: purchase capability and Shopping

A task or subtask can enable **Purchase task** independently of its project's workflow. This is how isolated purchases in an ordinary project join Shopping.

A `purchase_requirements` record attaches uniquely to a task. Read title, project and domain from the source; do not create duplicate shopping tasks. Fields can include needed/satisfied state, store/supplier, product link, quantity/unit and purchase notes. Preserve the requirement identity when the task moves.

The Shopping navigation item aggregates requirements across projects, areas and domains. Default To buy shows explicitly needed, active sources; Waiting and satisfied requirements remain available in separate filters. Include source breadcrumbs and filters for store, project and domain. A missing store is Unspecified.

### Independent purchase and work state

Purchase tracking is independent of workflow status. Recording Bought satisfies the purchase requirement and records the event. **It does not automatically complete the task or advance to the next custom status in this release.** This preserves “Buy and install a shelf” as work still needing installation. A purchase subtask is also a useful way to separate those actions.

Do not derive behavior from labels such as Bought or from dropdown order. A later opt-in mapping could explicitly connect Bought to Need to pack, or Mark needed to Need to buy. Treat this as a later convenience, not a prerequisite.

Ordinary task completion must not fabricate a purchase record. When purchase tracking is enabled, explain this distinction in the controls. A completed source is excluded from actionable Shopping; reopening it does not itself claim a new purchase or a newly depleted stock level. Mark needed is an explicit action, and must make the source actionable or explain the blocker.

### Purchase commands and records

- Record full purchase, optionally with quantity/cost/store, satisfying the current requirement.
- Record partial purchase, retaining the remaining need. A partial purchase never anchors a replenishment interval.
- Mark needed again, retaining the reusable task and purchase history.
- Clear a need without claiming a purchase.
- Correct/void a mistaken purchase and mark needed when appropriate; do not create a generic compensating-event system.

Reuse the transaction and command-error conventions in `lib/maintenance-tx.ts` and `lib/command-error.ts`. Reuse `operation_receipts` for commands whose retries would otherwise duplicate purchase records. Preserve a stable purchase identity suitable for later finance links; assess reuse of PR #21's `shopping_purchases` before designing a competing identity.

Do not enable this capability on maintenance-generated tasks; use an ordinary procurement task or subtask for parts. Initially defer combining purchase requirements with existing task recurrence until visibility and schedule ownership are defined. Reject that combination clearly in both directions.

## 4. Kit inspections reuse maintenance

A kit needing scheduled care can be an equipment asset with an associated area project. Its contents remain primary tasks/subtasks. Simple manual lists do not require assets.

Use existing `maintenance_items` for inspections, expiry and replacement. Battery testing and a six-month replacement deadline are separate obligations where appropriate. A due check generates a linked action while the source kit item stays Packed. Add a task context link if needed for navigation; it is not a second scheduler.

Reuse existing policies, `maintenance-sweep.ts`, attention reconciliation, evidence validation, event-key deduplication and reactivation catch-up. Calendar handling should use `tz.ts` and `addMonthsClamped`. An adverse inspection can lead to an explicit repair or purchase task without pretending that completing the inspection fixed the equipment.

Groceries represent acquisition needs and availability. Routines represent repeated behaviors and adherence; those are different questions, so grocery tasks should not be forced into routines.

## 5. Later work to preserve from the old shopping spec

The existing shopping PR is not fully superseded by custom statuses alone. Preserve or explicitly retire each of these requirements before closing it as replaced:

- Purchase history and corrections.
- Recurrence/replenishment, including purchase-relative versus calendar-based intervals.
- Skipping a shopping cycle without claiming a purchase.
- Archive/hide behavior with retained history.
- Previewable import, explicit interpretation of old checked values, and repeat-safe import identity.
- Voice commands invoking the same purchase operations and retaining retry identity.

For timed replenishment, decide explicitly whether an elapsed interval creates actionable purchase intent or only a review reminder. A scheduled need is not evidence of depleted stock. Full fulfillment may anchor a purchase-relative interval; partial and voided purchases never do. A skip advances cycle satisfaction separately from the last actual purchase. Define the eligibility window for rolled-forward recurring tasks before adding them to Shopping.

General inventory quantities, automatic stock deductions, preset version subscriptions, arbitrary transition automation and a second recurrence engine are outside the first delivery. Full workflow transition audit history is also deferred; existing task timestamps and later purchase/maintenance histories remain distinct.

## 6. Rollout and verification

Delivery order:

1. Task/subtask custom statuses, local opt-in, app-wide copied presets, compatible canonical status handling.
2. Per-task purchase capability and aggregate Shopping, with purchase history and command retry protection.
3. Kit maintenance context links and due-check presentation using the existing module.
4. Recurring purchase eligibility and replenishment, then voice/import integration.

Migration precautions:

- Earlier read-only inspection found zero-row legacy shopping tables and overlapping migration names in the owner's development database. That observation was from the old capture checkout, not proof of the current deployment state.
- Before deployment, inspect the target migration tracker. Apply the additive workflow migration through the normal migration process. Do not drop shopping tables or rewrite migration history as part of this feature.
- Test both a fresh bootstrap and the populated 0047-to-current upgrade, including a second application of every migration.

First-delivery acceptance:

- Ordinary tasks keep checkboxes; opting in one scope does not change neighboring projects.
- Projects, areas, direct domain tasks and subtasks all use the correct scope.
- Grocery and kit cycles work without requiring a label named Done.
- Activation/disable preserve canonical categories and completion history.
- Legacy status updates and scope moves select appropriate defaults.
- Renaming occupied statuses works; removal/category changes are blocked.
- Presets copy across domains and remain independent after editing/deletion.
- Stale settings and simultaneous status/configuration changes cannot leave invalid selections.
- Recurrence rolls forward once; maintenance evidence failures roll back the status change.
- Primary web controls display custom stages, include Waiting subtasks, and expose failed saves.
- Typecheck, production build, API/web tests and populated migration tests pass before deployment.
