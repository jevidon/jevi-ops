# Compact domain browsing — issue #79

## Revision — 21 September 2026

The first cut (below) was reviewed against a clickable prototype and revised.
What the board does now, and why it differs from the original decision:

- **Two independent columns on desktop, one on mobile.** The collapsed list
  of thirteen domains was one long stack with most of the page empty once the
  sidebar went. Cards are dealt into two column wrappers (even indices left,
  odd right); below `lg` the wrappers become `display: contents` and each
  card's `order` restores row-wise reading order. One DOM tree serves both,
  so there is no viewport check in JS and no hydration mismatch. A card's
  contents open **inside its own column**, directly under its bar; only the
  cards beneath it in that column move.
- **Name navigates, everything else toggles.** The whole-row-button design
  hid navigation behind a second tap on desktop too, where there is room for
  both. The domain name is now a link at every width. A transparent button
  the size of the card is the disclosure control: it carries `aria-expanded`
  and `aria-controls`, Enter and Space toggle it, and keyboard focus rings the
  whole card. Because it is absolutely positioned it paints above the in-flow
  content, so a tap on the engraving, pill, counts or empty space toggles;
  the name link is raised above it. Desktop keeps a decorative right-side
  arrow that rotates when open; mobile has no arrow, and an open card sits on
  the raised paper surface instead, clearing on collapse. There is no hover
  tint: touch browsers pin `:hover` to the last tapped element, which made a
  collapsed card look open, and on desktop the pointer cursor and the arrow
  already mark the card as interactive. (An `@media (hover: hover)` gate was
  tried first and dropped; note for later that the app-wide Tailwind flag is
  not an option either, because sixteen files reveal controls with
  `group-hover` and would lose them on touch.) The open tint bleeds 8px past
  the content on both sides so the pill and arrow never sit on its edge.
  “Open domain” stays inside the panel too.
- **Engraving in the lead slot, inked in the domain colour.** Every card
  carries its drawing (committed engraving or the name-seeded motif), set to
  the left of the name in a fixed-width slot so names align down a column.
  The drawing is inked in the domain's identity colour — primary strokes full,
  faint strokes at half — which retires the separate colour chip. The urgency
  pill spans the slot's full width beneath the drawing, label left-aligned.
  Open, overdue and waiting counts sit under the name. The old “overdue
  domains re-ink in rust” signal now lives only in the pill.
- **Open cards persist in a cookie the server reads.** sessionStorage restored
  after hydration meant a collapsed first paint that popped open under the
  user and broke back-navigation scroll restore. `browse-state.ts` defines the
  cookie; the page component reads it, filters to ids the payload still
  knows, and passes `initialExpanded`, so the first paint is already right.
  Search text and the parked toggle are no longer persisted.
- **Deferred.** Choosing a domain colour (the project/area swatch palette)
  belongs in the Edit domain flow and is a separate work item. Project kind
  (area vs project) is not surfaced at this vantage point.

## Interaction decision (before implementation)

The `/domains` index redirects to `/work`, so this change belongs to the Work
view. Use a full-width button for each domain row. All domains start collapsed
on a first visit. The row shows the full name, server-derived urgency and task
counts, plus counts of assets, projects and content. Multiple rows may stay open.

On mobile, put the visible “Show contents” / “Hide contents” cue and chevron on
the context line below the name. Do not reserve a control column beside the
name. On desktop the same button carries a right-side chevron. The whole row
is the touch target; Enter and Space toggle it with native button behavior.
Expose `aria-expanded` and `aria-controls`, with a visible keyboard focus ring.

Place an explicit “Open domain” link first in each expanded panel. This costs
two taps from the collapsed state, but separates navigation from disclosure,
avoids nested interactive elements, and gives long names the available width.
A title link plus separate arrow was considered: it saves a tap for navigation,
but divides the row into competing targets and crowds small screens. A row
that navigates on one tap and expands through another gesture was rejected as
hard to discover and use with a keyboard. Brief page guidance explains both
actions before the first row.

Remove the sidebar facets and use the reclaimed width. Keep inline text search;
matching a child retains its whole domain so hierarchy and rollups stay intact.
Search does not silently open or close rows. Preserve expanded domains, search
and the parked-list toggle for return visits in the same browser tab. A new
tab/session starts collapsed. Storage failures must not prevent browsing.

The current Work payload models areas as assigned assets, with projects carrying
an optional asset reference. Show each asset with its linked projects beneath
it, then remaining projects, content and direct tasks. Keep existing card detail,
urgency, art, Tomorrow's Focus and quick-add actions. Do not introduce a new area
model. Panels and grids must shrink below the old 258px card minimum on narrow
screens; names and context must wrap.

## Validation plan

- Component tests: initially collapsed, independent toggles, keyboard operation,
  accessible state/panel association, explicit navigation, grouped projects,
  search, empty/parked domains, and restoring browsing context.
- Browser checks at narrow mobile and desktop widths: long names, wrapping,
  overflow, focus visibility, and touch targets.
- Web tests, TypeScript and lint checks.

## Validation results — 19 September 2026

- All 47 web tests pass, including six new browsing component tests. These use
  the real cards, focus and quick-add components with server actions mocked.
- Web TypeScript passes. Targeted lint of the view and its tests passes.
- Production web build passes; it reports the existing `jose` warnings about
  CompressionStream / DecompressionStream in the Edge runtime.
- Browser validation rendered the actual WorkView and application CSS with
  synthetic domain data and mocked navigation/server actions in a local preview.
  At 320, 375, 800 and 1440px, document width stays within the viewport.
  Long phrases and a long unbroken domain name wrap without clipping. Expanded
  cards fit at 320px. Native Enter/Space toggle the row and retain a visible
  focus outline. Row targets span the available width and exceed 44px high;
  the explicit detail link also has a 44px minimum height.
- Return-state persistence is covered by component remount tests and observed
  on browser reload. This is not a production-data navigation test or a physical
  touch-device test; mobile validation covers responsive rendering and full-row
  pointer targets in the browser.
