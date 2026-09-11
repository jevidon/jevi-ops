# 03 — Vehicle onboarding: reusable, progressive and non-blocking

**Depends on:** [01](01-ONBOARDING-FRAMEWORK.md), the record contract in [04](04-VEHICLE-RECORDS-AND-MARKDOWN.md), and manual compliance in [05](05-COMPLIANCE-AND-MANUAL-MANAGEMENT.md).\
**Requirement coverage:** R04–R12, R15.\
**Launch:** During core setup, from Add vehicle, or from an existing vehicle to fill gaps.\
**Do not require:** A model, research worker, VIN, odometer, comprehensive history or known compliance state.

## Design principle

Understand the person's desired relationship with this particular vehicle before exposing detail. Experience, practical involvement, documentation availability and interest in upgrades are different dimensions. A person may outsource all maintenance, keep meticulous receipts and still plan a substantial accessory build.

The flow has a short path and progressive detail, not mutually exclusive “beginner” and “expert” products. Every question can be revisited later. A deeper answer must not imply broader permission for autonomous agent actions.

## Screen V0 — How should Jevi Ops help?

**Prompt:** “What would you like help with for this vehicle?”

Ask a few independent questions, with “Not sure yet” and a skip option:

| Dimension | Example answers | Product effect |
|---|---|---|
| Primary goal | Keep on top of servicing; maintain records; understand maintenance; plan improvements | Order relevant sections and next actions |
| Practical involvement | Use a service provider; do simple checks; do some work myself; do most work myself | Tailor language and optional procedure detail |
| Confidence/experience | New to this; comfortable with basics; experienced | Adjust explanation depth, not hidden assumptions about skill |
| Improvement interest | None now; maybe later; actively planning | Reveal optional idea/project capture |
| Desired detail | Essentials; balanced; detailed | Progressive disclosure only |

Store these as per-vehicle preferences, optionally seeded from owner defaults. Do not collapse them into a permanent persona classification. No history is required to answer; possessing records is not evidence of mechanical expertise.

**Result:** A presentation preference, not maintenance recommendations or regulatory conclusions.

## Screen V1 — Which vehicle?

**Prompt:** “Tell us the vehicle basics.”

| Field | Requirement and behaviour |
|---|---|
| Year | Core field; accept a plausible integer and allow correction. Preserve whether a supplied year is model year or first-registration year when known; do not silently substitute one for the other. |
| Make | Core field; suggestions plus free text |
| Model | Core field; suggestions plus free text |
| Trim/variant | Core field shown alongside model; allow “Not sure” |
| Display name | Optional user nickname; otherwise a deterministic label from supplied identity |
| Current odometer | Optional; numeric, non-negative, never default missing to zero |
| Odometer unit | Explicit `km` or `mi`; store with the reading and honour the choice independently of country |
| Reading date | Default to today in confirmed application timezone for a “current” reading; editable, and clearly shown |

The selected implementation default requires year, make and model to finish this **vehicle wizard**, while allowing unknown trim. It must not tighten unrelated generic asset creation.

An “Add identifiers” expansion permits VIN, chassis/frame identifier, model code and registration plate. They are distinct fields. Do not require every imported-vehicle identifier to satisfy a 17-character VIN rule. Keep identifiers as strings, including leading zeroes. Registration plate is optional, sensitive and not the database identity.

Do not infer fuel, engine, exact market specification or installed equipment from “TX.” Future decoding can return proposed facts with provenance; it is not part of the minimum path. A deterministic decoder or ordinary lookup service would not intrinsically require a general agent, but no such capability should be assumed present.

### Worked example from this discussion

| Field | Value | Provenance |
|---|---|---|
| Year | 2015 | User supplied |
| Make | Toyota | User supplied |
| Model | Land Cruiser Prado | User supplied |
| Trim | TX | User supplied |
| Odometer | 87,600 | User supplied |
| Unit | km | User supplied |
| Reading date | 2026-09-08 as the session's “today” default | UI/default date, not a separately spoken exact date |

Present `87,600 km`; retain the numeric value `87600`. This reading is not evidence that any maintenance was performed at that distance.

## Screen V2 — Where is it based and registered?

**Prompts:** “Where is this vehicle normally based?” and “Where is it registered?”

Collect the two countries separately, with a convenient **Same as where it is based** choice. Country must not silently overwrite the odometer unit. Ask region/state/province where relevant; allow unknown or later rather than guessing. Additional operating jurisdictions can be optional detail, not mandatory travel history.

For the worked example, both country answers are **New Zealand**, stored using the application's country representation, such as `NZ`. Region was not supplied in this flow and need not be inferred from the owner's location.

Explain that location helps organise relevant responsibilities, but the application has not automatically verified those responsibilities. A jurisdiction change should flag existing applicability assessments for review rather than deleting or replacing their schedules.

## Screen V3 — Current state and relevant specification

**Prompt:** “Anything else we should know about the vehicle as it is today?”

Offer optional ownership/purchase date and purchase reading, lifecycle, general condition, and whether the vehicle is standard, modified or unknown. Default active lifecycle only as a visible, changeable UI choice; preserve a stored/sold lifecycle on an existing asset.

Provide optional fuel/powertrain, engine/variant, registration or vehicle class, and import/origin details when the user knows them. These can matter to later rule applicability, but unknown remains valid. Registration class is not safely inferred from a marketing label like SUV. Model year and registration year must remain distinguishable.

Detailed tyres, equipment, installed accessories and known issues are expandable. Users can upload or link a specification label without requiring automated extraction. Do not generate servicing intervals from incomplete vehicle identification.

## Screen V4 — History and existing documents

**Prompt:** “What maintenance information do you have?”

Offer **No records**, **Some records**, **Detailed records**, and **Add later**. Treat the selection as the user's description of coverage, not a guarantee that every service is documented.

The no-records path creates a useful record from today, with unknown history explicitly noted. It must **not** mark past servicing complete, create an oil-change baseline at today's reading, or claim the vehicle is up to date. A current odometer baseline and maintenance-event evidence are different things.

For available records, permit manual entries, pasted notes and uploads. Preserve originals even when extraction is unavailable. Suggested fields are event date or date precision, work performed, provider, reading/unit when known, cost/currency when known, and source reference.

On existing assets the recorded meter unit is locked after readings exist. Mixed-unit history remains source evidence until an explicit conversion is reviewed; the wizard cannot relabel readings or imply a conversion API already exists. Map the first-screen trim field to existing metadata `variant`, as specified in 04.

Automatic extraction is an optional capability. Its output is a reviewable candidate timeline, not accepted maintenance history. Show uncertain dates, duplicated receipts, conflicting odometers and missing fields. Accept partial facts without manufacturing exact dates or a zero cost. Detailed extraction and commit behaviour is in [04](04-VEHICLE-RECORDS-AND-MARKDOWN.md).

Group multi-line workshop work as an existing service visit when appropriate and confirmed. Do not turn one invoice into several independent total costs or several contradictory readings. Importing old history must preserve current pinned schedules and the existing historical-event semantics.

## Screen V5 — Use and future plans

**Prompt:** “What do you use this vehicle for, and is there anything you would like to change?”

Optional answers include everyday transport, long-distance travel, towing, off-road use or other user-described needs. Approximate usage is labelled an estimate and never substituted for an actual odometer reading. Ask about plans only to the depth the user selected.

Keep **installed**, **ordered/not installed**, **an idea**, and **an approved project** distinct. Reuse the existing idea-project and project relationships rather than inventing a competing build-plan subsystem. Notes can capture an order status until a typed procurement workflow is genuinely required.

A proposed suspension upgrade or accessory purchase must not appear in the vehicle's installed configuration. Existing modifications can have install date/source and uncertainty without implying they have been assessed for legality or compatibility.

Domain assignment is optional. A domain-launched flow can preselect its domain. Reuse the repository's asset-as-area model; an unassigned vehicle is still a usable asset. Existing awareness behaviour must not be silently changed by this wizard.

## Screen V6 — Maintenance and compliance to track now

**Prompt:** “Are there any servicing or renewal dates you already know?”

Let the owner add a known maintenance item or obligation, a due date, a distance threshold, an issued expiry, or a prepaid-distance balance using the existing supported policies. Capture where the information came from: receipt, document, service provider, user recollection or another source.

Offer **I do not know yet** and **Set this up later**. With no research capability, say so and keep manual entry available. With a capable configured agent, allow a separate research request; its status cannot block finishing the vehicle.

Jurisdiction-specific labels may help, but do not auto-install legal rules, expiry dates, rates or service intervals merely from selecting a country. A generic or user-created reminder is not automatically a verified legal obligation. Apply the data contract in [05](05-COMPLIANCE-AND-MANUAL-MANAGEMENT.md).

## Screen V7 — Review, save and begin

Show a concise summary of identity, optional reading, jurisdictions, preferences, supplied history, installed equipment, proposed projects and tracking items. Separate confirmed user facts, imported candidates awaiting review and unknowns. Show exactly what saving will create or modify.

For the worked example with no further answers, the summary can say:

> 2015 Toyota Land Cruiser Prado TX. Recorded odometer: 87,600 km. Based and registered in New Zealand. Service history and regulatory responsibilities have not yet been established.

Use **Save vehicle** or **Finish setup**, not “Vehicle compliant” or “Maintenance complete.” For a new vehicle, use one idempotent reviewed commit through the normal asset/reading/document/maintenance services. For existing vehicles, preview only changes and use concurrency checks against the facts and document versions originally read.

After saving, open the normal asset page with optional next actions: add records, enter a known obligation, review an idea, or request research when available. Unknowns are visible and actionable without forcing the user back into the wizard.

## Implementation tasks

- [ ] Build V0–V7 as one module with progressive detail and independent launch/resume paths.
- [ ] Add shared vehicle draft schemas and typed metadata conventions; reuse asset IDs and reading tables.
- [ ] Implement unit-safe odometer entry and explicit date defaults; preserve identifier strings.
- [ ] Add separate country fields and optional relevant specification without online dependencies.
- [ ] Add history coverage choices and manual/raw-upload paths before automated extraction.
- [ ] Reuse service visits, history validators and idea-project relationships.
- [ ] Wire manual obligations and research-request placeholders with honest availability status.
- [ ] Implement exact preview, concurrency-safe commit and normal asset-page handoff.
- [ ] Test novice/reminder-only, outsourced enthusiast, DIY owner, unknown-history and second-vehicle paths.

## Acceptance criteria

The confirmed Prado example finishes without added facts or invented schedules. A vehicle can also finish with no odometer, no identifiers, unknown trim and no history. NZ jurisdiction does not force `km` over an explicitly chosen `mi`. Basic users are not required to list modifications or understand mechanical terminology. Enthusiasts can retain detailed records and separate build ideas. An absent agent or unknown legal obligations never blocks saving. Restarting or retrying does not create a duplicate vehicle, service visit, reading or project.
