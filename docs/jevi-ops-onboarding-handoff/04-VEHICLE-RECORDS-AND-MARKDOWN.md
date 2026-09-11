# 04 — Vehicle records, historical evidence and Markdown context

**Depends on:** M0 repository reconciliation; coordinate schema contracts with [03](03-VEHICLE-ONBOARDING.md) and [05](05-COMPLIANCE-AND-MANUAL-MANAGEMENT.md).\
**Requirement coverage:** R06–R13.\
**Outcome:** One durable vehicle identity, traceable operational facts, preserved human-authored knowledge and a safe context surface for an external agent.

## Preserve the repository's existing model

The inspected working stack already has assets, metadata facts, odometer readings, maintenance items/logs, service visits, linked projects and `doc_md` overview documents. Asset routes live in `apps/api/src/routes/maintenance.ts`; document versioning lives in `apps/api/src/lib/docs.ts`. See [S5–S8](00-START-HERE.md#repository-baseline-and-sources).

Do not create a parallel `vehicles` datastore, a second maintenance log, an independent odometer field that drifts from readings, or a second completion state encoded in Markdown checkboxes. Add vehicle-specific validation and presentation on top of the generic asset model.

## Source-of-truth decision

Use separate authority for separate kinds of information:

| Information | Authority | Treatment of other representations |
|---|---|---|
| Asset identity, typed profile facts, jurisdiction and preferences | Existing asset record and approved typed metadata | Markdown may describe them; conflicting prose is flagged, not silently parsed into a write |
| Odometer history/current reading | Existing reading ledger and authoritative latest-reading query | Generated summaries include reading date/unit and can be rebuilt |
| Maintenance, expiry/prepaid state, visits and task completion | Existing operational records and shared services | A checked document box is not a completed service |
| Narrative, rationale, plans, contextual reference and human explanations | Authored `doc_md` and linked source/reference artifacts | Preserve as durable knowledge, not disposable output from structured fields |
| Source documents | Preserved raw artifacts and their associations | Extracted text and model summaries are derived, reviewable representations |
| Research observations and legal applicability | Versioned evidence/assessment contract in 05 | Agent prose alone does not change an accepted obligation |

The wider Hermes plans treat Markdown as durable human knowledge. Keep that property. It does not require replacing Jevi Ops's Postgres database or making every operational event a Markdown edit. For this implementation, the existing `doc_md` content can be the canonical vehicle narrative even though its bytes are stored in Postgres.

Do not implement bidirectional filesystem synchronization as an incidental onboarding feature. Future wiki integration must explicitly choose ownership per section/field, stable IDs, conflict policy and an import/export contract. It must not create two writable masters for the same field.

## Logical vehicle profile

Map these logical fields onto existing profile keys where present; extend shared schemas only where missing. The names below are conceptual, not a demand for matching new columns.

| Group | Facts to support |
|---|---|
| Identity | Year and its meaning when known, make, model, trim/variant, optional nickname |
| Identifiers | VIN, chassis/frame identifier, model code, plate as distinct optional strings |
| Jurisdiction | Based country/region and registration country/region, with recorded changes |
| Relevant specification | Fuel/powertrain, engine variant, vehicle/registration class, import/origin where known |
| Ownership/state | Purchase date or precision, purchase reading with unit, lifecycle, installed equipment and known issues |
| Preferences | Goals, practical involvement, confidence, detail preference, improvement interest |
| Information coverage | History coverage, deferred sections and known gaps |

Use a shared typed schema rather than unbounded string guessing, but preserve existing unknown metadata keys and valid provenance wrappers. Reuse current fact-reading helpers and per-key compare-and-set behaviour. A form submitting an unchanged identifier must not change its type or strip its source metadata.

Map wizard trim to the existing `variant` key. Retain existing `year`, `make`, `model`, `vin`, `plate`, `first_registered`, `purchased_on`, `purchased_meter`, `engine`, `usage` and free-text `location` meanings. Add shared typed keys for `year_basis`, `chassis_id`, `model_code`, `based_country`, `based_region`, `registration_country`, `registration_region`, `fuel_powertrain`, `registration_class`, `import_origin` and `history_coverage`. Use dedicated typed metadata objects for `vehicle_preferences`, `installed_equipment`, `known_issues` and `vehicle_answer_states`; do not make generic scalar fact helpers guess their structure. Partial dates and source details stay in typed companion evidence rather than changing existing exact-date semantics. Publish these schemas before vehicle screens consume them.

Important facts need value, source kind/reference, recorded time, and observation/effective time where relevant. A field that was never asked is different from one the user explicitly does not know. Confidence is a meaningful label, not a fabricated numeric probability. User confirmation is evidence of what the user reports, not automatic official verification.

## Odometer rules

Use the reading service for all current, historical, corrected and imported readings. Store the original amount and unit association. Do not reinterpret a numeric `87600` when a country or display-unit preference changes.

The existing stack stores the unit on the asset and locks it after readings exist. It has no implemented unit-conversion endpoint. Respect that invariant: the onboarding unit selector is freely editable before committing the first reading, then locked. A future unit-conversion migration is separate work. Preserve a historical source's original amount/unit in its candidate evidence; a mixed-unit candidate needs explicit, reviewed conversion before it can enter the asset's ledger. Never relabel an existing number.

A current reading is not a service event or a baseline for every maintenance item. Use the authoritative latest-reading query, not the first item of a truncated history list. Keep stale/absent reading confidence separate from due/overdue urgency. Do not implement a replaced-odometer epoch system in this work merely to bypass existing decrease validation.

## Raw artifacts and historical ingestion

Deliver raw-source preservation and manual entry in M1. Automated extraction can be added behind a capability flag without blocking onboarding.

Use this staged pipeline:

```text
upload or paste
  -> durable raw source + asset/draft association
  -> optional text extraction
  -> candidate events/facts with source locations
  -> duplicate/conflict review
  -> owner acceptance
  -> normal visit/log/reading services
```

Minimum source metadata: stable source ID, original filename or supplied label, media type, content hash, storage reference, received timestamp, asset association and processing status. For extracted candidates add source page/line where available, extraction method/version, original text span, uncertain fields and review state.

Validate supported types and sizes and sanitise filenames/paths. Existing image upload capability must not be assumed to accept PDFs or arbitrary files. Extend the storage/attachment contract deliberately, with authenticated retrieval for sensitive records. Treat document content as untrusted data; it cannot instruct an agent to change permissions, reveal secrets or bypass review.

Store private source bytes outside the directory served by the existing public `/uploads/` route. Adding an authenticated route to the same public files is insufficient. Use opaque source IDs, authenticated retrieval compatible with web session handling, source-to-session/asset associations, and acceptance receipts linking candidates to created records. Start with PDF, plain text/Markdown and supported receipt images, with validated content and explicit size limits. Retain existing photo URLs/gallery behaviour. Hashes identify raw content, not permission to reuse another vehicle's association. Cleanup may remove only unreferenced abandoned-draft objects; it cannot remove committed/shared sources. Pasting an external link records a reference in M1 and does not silently trigger a network fetch.

A hash can deduplicate raw bytes, but never silently merge event records or associations across vehicles. A repeated import into the same vehicle should show the prior accepted source/events and avoid duplicating them.

### Historical semantics

Preserve approximate dates as approximate. A receipt labelled only “March 2024” must not become an exact, evidenced service on 1 March without confirmation. Retain partial history as a note/candidate until the normal event schema has sufficient evidence.

Use one existing service visit for confirmed multi-line work with a shared invoice and reading. Keep invoice total distinct from allocated line costs. Missing cost is unknown, not zero. Preserve original currency; neither NZ registration nor household currency authorises automatic conversion.

Backdated imports must not close today's task, replace a newer baseline, or move a pinned deadline merely because ingestion happened today. All corrections, undo and retries go through the existing visit/log/reading services. Do not bypass evidence requirements to achieve a green import screen.

## Vehicle Markdown overview

On first creation, offer a lightweight starter document, not a long generated biography. Example structure:

```markdown
# Vehicle overview

## What this vehicle is for
User-authored context and operating goals.

## Maintenance approach
How the owner wants help and who normally performs work.

## Current configuration and known issues
Narrative linked to confirmed facts, with uncertainty noted.

## History and sources
Links to service records, invoices, manuals and other artifacts.

## Plans and decisions
Links to ideas/projects; do not mark proposed work as installed.

## Regulatory context and open questions
Links to accepted assessments and research awaiting review.
```

Do not automatically copy every structured fact into authored prose on every edit. Prefer a separate rendered facts block/context snapshot so routine odometer updates do not overwrite the narrative. Where narrative contradicts structured facts, surface the conflict and its sources; an agent may propose a reconciliation but cannot silently choose a winner.

Use `doc_version` on every document write, including agent edits. A stale write returns a conflict and keeps the proposed draft. Never send `doc_force` as a normal automated retry strategy. Preserve the initial body, every accepted revision, actor and no-op-save behaviour already implemented in the document service.

Document checklist marks remain document marks. Creating an actual task from a line uses the existing explicit promotion action and stable task identity.

## Agent-readable context

Extend or wrap the existing `GET /api/assets/:id` bundle rather than generating an unrelated vehicle summary service. The agent must receive enough authoritative context to distinguish current facts from narrative and pending proposals.

The safe context should include asset ID; schema/context version; typed facts and provenance; narrative plus `doc_version`; authoritative latest reading/date/unit; selected historical records; existing obligations and their evidence; ideas/projects and installed-state distinction; open gaps; active assessment versions; and permissions/preferences relevant to the requested work.

Provide pagination or source-reference follow-up for longer histories. A truncated bundle must declare truncation; it must not imply no older records exist. Include per-resource revisions or a verifiable snapshot marker so a result can be checked for staleness before application.

No provider key, settings secret or unrelated household record belongs in this bundle. Default external research context should omit plate, full VIN and raw receipts unless the specific operation needs them and sharing is authorised.

Offer a human-readable Markdown export with a generated facts section clearly labelled as a snapshot, alongside the authored narrative. Include stable asset ID and export time/version. Export is useful without a worker. Importing such a file later must be a previewed, version-checked operation, not a background two-way overwrite.

## Implementation tasks

- [ ] Document field ownership and map new vehicle fields to existing metadata/shared schema conventions.
- [ ] Preserve metadata compare-and-set and reading invariants in onboarding commits.
- [ ] Add missing source-document types, associations and safe retrieval without breaking the existing photo gallery.
- [ ] Implement manual history entry and a staged candidate import/review path.
- [ ] Reuse visit grouping, cost/currency rules and idempotent evidence services.
- [ ] Add optional initial Markdown, versioned editing and a separate generated facts snapshot.
- [ ] Extend the existing asset context bundle with provenance, versions, gaps and declared pagination.
- [ ] Add safe Markdown export; defer external filesystem synchronization behind an explicit future contract.
- [ ] Add regression tests for concurrent edits, duplicate ingestion, ambiguous dates and historical corrections.

## Acceptance criteria

Authored Markdown survives structured fact changes and vice versa. The initial document remains in revision history. A concurrent agent cannot overwrite newer user text or unrelated metadata. An old receipt cannot accidentally reschedule current work. Reimporting a source is idempotent. A document checkbox cannot complete maintenance. The agent sees dated authoritative readings and unknowns, not an invented complete vehicle profile. All of these behaviours work with external research disabled.
