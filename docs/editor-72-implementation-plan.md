# Issue #72 — Consistent editors and reliable return navigation

Status: approved implementation plan. The first task-editing delivery is implemented; see `editor-72-rollout.md` for validation and remaining work.

Issue: https://github.com/jevidon/jevi-ops/issues/72

Prepared 21 September 2026 from the local JeviOps checkout at `fa5de75c317e8d06c8dfa6249002a1638e155a30`, the issue requirements, and the owner's decisions in this conversation. The checkout has unrelated local changes; implementation should use an isolated checkout and refresh this audit against the then-current main branch.

## 1. Intended outcome and confirmed decisions

Editing should temporarily cover the page the user is working in. Saving successfully closes the editor and restores that exact context, with the saved information refreshed. Filters, grouping, selected date, expanded sections, and scroll position should survive. Home is a return destination only when Home actually launched the editor.

The owner confirmed:

- Successful Save closes an existing-item editor.
- Return to the last place the user was working, rather than redirecting to Home.
- Delete is visible in the editor header, with confirmation before any deletion.

The shared presentation will be a right-hand panel on desktop and a full-width, full-height panel on mobile. Save stays accessible at the top. Start with tasks, prove the complete interaction, then adopt it across the other editors.

## 2. What the current code does

| Area | Observed behavior | Planned change |
|---|---|---|
| `components/detail/EditDrawer.tsx` | Local open state, 440px width capped at 92vw, sticky title/Close header, body scroll lock | Shared editor shell, full mobile width, header actions, guarded dismissal and complete focus management |
| Existing drawer accessibility | Dialog attributes exist; Escape and backdrop close immediately; no explicit focus trap or restoration | One accessible modal lifecycle, including nested confirmations |
| `tasks/task-form.tsx` | Save at the bottom; create says Add task; Delete lives in a separate bottom danger zone | Register form actions with the header; use Save; move Delete into the header |
| Task update action | Returns success/error and revalidates several routes | Preserve validation, return explicit mutation results, refresh all affected contexts and close only on success |
| Task creation action | Redirects to a supplied `returnTo`, otherwise to the new task | Separate mutation from presentation; panels close to their origin, direct entry has an explicit fallback |
| Task deletion action | Catches deletion errors, then redirects to `/` regardless | Return errors without leaving; navigate only after confirmed successful deletion |
| `tasks/tasks-view.tsx` | Several filters and view choices live only in component state | Keep the view mounted during editing; provide restoration for flows that navigate away |
| Notification bell | Mounted globally as a floating mobile control when unread notifications exist | Suppress on editing and record-detail surfaces; retain on overview/workspace surfaces |
| Markdown `DocEditor` | Has its own dirty tracking, version conflicts and save-in-flight protection | Preserve these capabilities when integrating common presentation and dismissal behavior |
| iOS shell | Enables native back/forward navigation gestures | Verify gestures with editor history and dirty drafts; do not equate Escape handling with native Back protection |

Existing drawer consumers include tasks, projects/areas, domains, assets, content, people, companies, and library books, notes, journal entries and highlights. Some drawers contain a primary form plus a separate deletion form, so a header cannot safely infer which form to submit.

## 3. Interaction contract

### Header and layout

- Put Cancel at the leading edge, a short editor title in the available title space, and a visible subdued Delete followed by the primary Save action on the trailing side. Delete appears only for an existing deletable record.
- Separate Delete from Save with spacing and distinct styling. The confirmation's destructive button carries the stronger warning treatment.
- At narrow widths or larger text sizes, move the title onto its own header row. Keep action labels visible and touch targets at least 44px; do not shrink labels or hide Delete in a menu.
- Retain approximately the existing desktop width for ordinary forms, with a defined wider variant for forms that need it. On mobile, use the full viewport width and available dynamic height, safe-area padding, and a separately scrolling form body.
- Keep the header outside the scrolling body. Cover or make the underlying app controls inert while a modal is open. Respect reduced-motion preferences.

### Save

1. Validate the actual form, including native required-field validation and existing server rules.
2. Mark the editor as saving and prevent duplicate submissions or concurrent deletion. Freeze editable fields for the submitted snapshot so newly typed text cannot be lost when a successful save closes the editor.
3. On success, refresh the affected records, close the editor, restore the origin and focus, and show one concise success toast.
4. On validation or API failure, keep the editor open with all entered values. Announce the error and focus the relevant field or error summary.
5. Reopening the editor must show the saved server values, not stale initial props or a previous draft.

An unchanged existing form can disable Save while Cancel remains available. A failed refresh after a confirmed mutation must not be reported as a failed save or cause a duplicate creation attempt: show that the save succeeded and offer refresh recovery.

### Cancel and unsaved changes

- A clean editor closes immediately.
- A dirty editor offers “Keep editing” and “Discard changes” before closing. Keep editing is the initial safe focus.
- Header Cancel, Escape, desktop backdrop dismissal and app-owned navigation use the same close-request function. A confirmation closes before the editor when Escape is pressed.
- Ordinary modal closing is blocked while a mutation is pending, with visible progress and an error/retry path when the request fails. Do not describe aborting a network request as undoing a server mutation.
- Register a browser unload guard only while dirty. Test browser Back and native iOS gestures separately; the app must not claim these are protected merely because a `beforeunload` listener exists.

### Delete

- The header Delete button opens a confirmation that names the item and describes relevant consequences, including dependent records where applicable.
- No delete request runs when the confirmation opens, is dismissed, or is cancelled.
- Confirmation performs one deletion, prevents concurrent Save, and shows pending feedback.
- Success closes the editor, removes the deleted record from the refreshed origin view, and restores context. If the underlying page is the deleted record's detail page, return to the recorded previous valid view.
- Failure keeps both the record and editor accessible with an actionable error. Keep the unsaved draft available after cancelling or failing deletion.
- Preserve entity-specific deletion restrictions. This work does not make previously protected records deletable.

## 4. What “return to the last spot” means

Track the immediate editor origin separately from the previous page used to reach a record. Breadcrumb ancestry is a fallback, not evidence of where the user came from.

| Starting flow | Save or Cancel | Successful Delete |
|---|---|---|
| Filtered task list → editor | Same task list, filters and scroll | Same refreshed list; focus the next suitable row or list heading |
| Project page → new-task editor | Same project, group and scroll | Not applicable before creation |
| Task detail → Edit | Same task detail and scroll | Previous recorded view, such as the project, Today or search results |
| Home Today → new-task editor | Same Home/Today position | Not applicable before creation |
| Directly opened edit URL | Record detail after Save/Cancel | Valid parent context, then the Tasks list |
| Directly opened task creation URL | New task detail after Save; Tasks list on Cancel | Not applicable |

For task deletion without a usable origin, prefer an existing parent task, then project, then domain, and finally `/tasks`. Skip inaccessible or deleted destinations. Do not redirect to the deleted item, an authentication route, an external URL, or a navigation loop.

Store a bounded, tab-scoped context record containing a unique navigation-entry key, pathname/query/hash, scroll position or anchor, focus target and the view's serializable state. Scope it to the current user/installation and clear it when that context changes. Store navigation state here, not form contents or credentials.

Preserve the underlying React page whenever possible. Use saved view state only when a page must remount; a URL alone will not restore the current All Tasks filters. Restore after refreshed content is laid out. If a saved row disappeared, use the nearest remaining anchor and clamp scroll to the new page height.

Only use history Back for a known app-owned editor entry. For direct entry or missing history, replace with the resolved safe destination. Parse and validate return paths on the server as well as the client; reject external/protocol-relative paths, malformed values and disallowed internal destinations. Build query parameters through URL APIs rather than string concatenation.

## 5. Proposed shared implementation

### Editor shell and form adapter

Introduce shared modules under `apps/web/src/components/editor/`:

- `EditorShell.tsx`: presentation, labelled dialog, fixed header, scrolling body, focus containment, background inertness and scroll restoration.
- `EditorProvider.tsx`: active editor session, origin, mutation state and common close requests; mounted in the authenticated layout.
- `EditorActions.tsx`: Save, Cancel and optional Delete, with consistent pending/disabled states.
- `ConfirmEditorAction.tsx`: discard and delete confirmations with the same accessible focus lifecycle.
- A small typed form adapter/hook: explicitly supplies the form ID, dirty state, pending state, save result and optional delete operation.

Keep `EditDrawer` as a compatibility wrapper during migration. Convert each consumer deliberately rather than changing every form's behavior at once.

Associate the header Save with a unique native form ID. Lift submission state from `useActionState` or the adapter: a `useFormStatus` call outside the target form must not be assumed to observe that form. Give Delete its own non-submit control and mutation path. Avoid nested forms and DOM searches for the “first form.”

Dirty tracking compares normalized editable values against the opening baseline, including custom date controls, controlled selectors and rich editors. Editing a value and restoring it should clear dirty state. Refreshes must not reset dirty drafts. Existing Markdown conflict/version handling remains authoritative; it must not be replaced by a generic form snapshot.

### Navigation and route integration

Add shared context capture, safe-return resolution and view-state restoration helpers under `apps/web/src/lib/` and a corresponding provider in the authenticated layout.

Keep existing in-page Edit triggers as modal editors over their current detail pages. For task creation links that currently leave the source page, use a route-backed editor overlay with the existing `/tasks/new` route as its direct-entry fallback. The proposed App Router implementation uses an editor parallel slot and an intercepted creation route, reusing the same server-loaded form content. Add the slot's default and dismissal handling so it cannot linger on unrelated routes.

Prove soft navigation, hard reload, Back/Forward, modal dismissal and server-data refresh in the task slice before repeating the pattern for other create/edit routes. Ordinary record-title links continue to open record detail; an Edit action opens an editor.

App-owned navigation must consult the dirty guard before leaving. The first slice includes a browser/native-history investigation and implementation, including whether the existing iOS navigation delegate needs a narrowly scoped editor-state bridge. If a platform cannot reliably cancel a departure, explicitly design recoverable drafts and test their account isolation and cleanup before claiming that platform is protected. Do not install a second independent history mechanism that competes with the router or native gestures.

### Mutation results and refresh

Refactor task create/update/delete to return discriminated success/error results to panel callers. A successful result carries the entity identity and the information needed to refresh affected contexts. Retain small redirecting wrappers only where a standalone route requires them.

Keep validation, authorization and business rules on the server. Capture old and new parent relationships so moving a task refreshes both sides. Include task detail, parent task/subtasks, project/domain, All Tasks, Work, Home, Calendar, attention and linked content as applicable. Avoid assuming invalidating the projects index refreshes every project detail route.

Use the existing toast provider for panel completion. Preserve compatibility with the existing `?created=` toast handoff for remaining standalone flows, and ensure it cannot produce two toasts or overwrite history metadata introduced for return navigation.

### Notification policy

Use one explicit route/surface policy plus editor-open state, rather than scattered pathname checks or breadcrumb depth alone.

- Hide the floating mobile bell whenever an editor or confirmation is open.
- Hide it on individual record detail, create and standalone edit surfaces.
- Retain it on Home, review/list views and project/domain workspace pages when no editor is open, consistent with the issue's requested exceptions.
- Keep normal notification navigation available in the app navigation. Verify nested routes and larger text; do not remove notification access globally.

## 6. Adoption map and delivery sequence

| Delivery | Scope | Exit condition |
|---|---|---|
| 1. Shared shell and task editing | Shell, adapter, dirty guard, header Save/Delete, update/delete results, return context and task detail integration | Task edit/save/cancel/delete passes the full context and failure matrix |
| 2. Task creation and navigation | Shared task form loader, creation overlay/direct fallback, source-link capture, view-state adapters, notification policy | Create from project/domain/Tasks/Today returns correctly; direct entry and history work |
| 3. Core entity editors | Projects/areas, domains, assets and content; existing standalone creation paths adopt the contract | Each entity passes save, cancel, dirty close, supported deletion and direct-entry checks |
| 4. CRM and library editors | People, companies, books, notes, journal entries and highlights; reconcile standalone company edit route | All current EditDrawer consumers use the shared contract, including entity-specific delete consequences |
| 5. Remaining editor audit and completion | Maintenance, routines, health and other standalone record editors; Markdown presentation integration where suitable | Every editor has a recorded adopted implementation or a specific justified exception and linked follow-up |

Keep inline actions such as task status changes, quick-add fields, log entry and settings saves as distinct interactions when an editor panel would add friction. Audit their behavior and document exceptions; “standardize editors” does not mean forcing every form in the app into a modal.

Each delivery should be a reviewable PR that leaves migrated surfaces usable. Do not close #72 after only the task pilot. Finish the agreed adoption map and explicitly record any remaining follow-ups.

Related issue boundaries:

- #66 owns Save + new. This plan defines its extension point: successful Save + new keeps the panel open, retains origin and agreed contextual defaults, clears saved content and focuses the next title. Its reset rules and feature implementation remain in #66.
- #69 owns quick-add placement and Create and open editor; it will reuse the shared session and return contract.
- #93 owns the broader visible Back control; editor navigation here supplies its common behavior.
- #83 owns new list controls; preserve the existing view state now without waiting for that redesign.
- #68/#77/#78 own document organization, attachments and field consolidation. Preserve existing data and editor capabilities here.
- #80 owns the repeated activity-log editing defects; it can reuse the confirmation component without delaying the editor work.

## 7. Validation and acceptance

Add meaningful component and integration coverage for:

1. Header Save submits the intended form and respects validation; different simultaneous forms cannot receive the wrong submission.
2. Successful save closes once and refreshes the saved record; failures preserve all draft fields and keep the editor open.
3. Rapid Save/Delete attempts cannot create concurrent operations or duplicate records.
4. Clean close versus dirty close through Cancel, Escape, backdrop and app navigation; cancelling confirmation preserves the draft and focus.
5. Delete confirmation makes no request until confirmed; API failure never redirects; success resolves a valid origin and skips the deleted record.
6. Origin validation, direct links, cold entry, refresh, missing history, deleted destinations, and query/hash preservation.
7. All Tasks filters/search/view, project grouping, selected Calendar date where present, expanded sections and scroll survive relevant editor flows.
8. Focus enters the panel, stays inside it, moves correctly through confirmations and returns to the trigger or a sensible replacement after deletion.
9. Mobile bell route policy and editor suppression, including nested detail routes.
10. Reopening after save shows fresh values; late refresh and repeated opens do not restore stale drafts or duplicate success toasts.

Run web tests, TypeScript, changed-file lint and a production build for routing/layout changes. Add server-action tests with mocked API failures to cover the deletion bug directly. Use browser integration checks for history and scroll; jsdom tests cannot establish those behaviors.

Exercise desktop at a typical wide viewport and mobile at 320px and 375–390px, with long titles, larger text, keyboard navigation and long forms. Physically verify an iPhone in the native wrapper and installed web app: keyboard open, safe areas, rotation, swipe Back, Save/Cancel/Delete, error recovery and reopening. Record physical-device validation as pending until it actually happens.

The release acceptance scenario is: open a filtered, scrolled project/task view; create or edit a task; Save; land at the same working position with updated information; reopen and delete with confirmation; remain in the correct valid context. Repeat with failed requests and unsaved changes. No unexplained Home redirect, silent draft loss, duplicate mutation or inaccessible header action is acceptable.

## 8. Risks and implementation controls

- History and native gesture handling are the highest-risk integration. Prove them in the first task slice rather than leaving them until broad rollout.
- Some forms have multiple independent save operations or versioned documents. Use explicit adapters and preserve their business semantics.
- Refreshing server content can reset local list state. Test the preserved-page path and the remount/restoration path independently.
- Dynamic mobile viewport and body scroll locking need physical-device checks; desktop emulation is insufficient.
- Mutation success and view refresh are separate outcomes. A refresh failure must not invite an accidental duplicate save or deletion.
- No database migration or new editor library is assumed for the initial task work. Introduce either only if the implementation audit demonstrates a concrete need.
- Apply changes in an isolated branch, retain the current application's field validation and entity rules, and avoid incorporating unrelated working-tree edits.

The next implementation step is delivery 1: establish the shared shell and complete task edit/save/cancel/delete behavior, including reliable return context, before expanding to additional entities.
