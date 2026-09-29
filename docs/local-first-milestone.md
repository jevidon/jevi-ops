# Local-first Domains milestone

The first shared workflow is Domains → project/area → existing task → durable local edit → synchronization. React owns the interface in both the browser and installed iOS bundle; Swift provides storage, credentials, capture and device integration. Existing capture files and task operations remain in place.

## Delivered slice

- Browse downloaded domains and projects/areas, including empty containers; read descriptions and overview text.
- Search saved tasks, projects and domains. Edit task title, notes, due date and existing workflow status without a server round trip.
- Save before sending, retain pending changes across relaunch, and distinguish local persistence from synchronization.
- Merge independent text/date/priority updates. Review conflicting values and fetch the latest server version for other rejections. Status transitions on a stale version always require review because they can trigger recurrence and maintenance actions.
- One shared navigation bar in the iOS workspace. Capture and retained recordings still use the existing native store and sheets.

`apps/web/src/components/local-workspace` contains the shared UI and adapter contract. Browser storage uses an account-keyed IndexedDB transaction; Web Locks serialize senders across tabs. Each editor records the local operation revision so an older tab cannot overwrite a newer saved edit. iOS delegates to the existing atomic-file store through a narrow bundled-frame WebKit bridge; credentials never enter JavaScript.

The installed app packages React, styles, HTML and fonts with `make generate`. It compiles the existing web `globals.css` and Tailwind config, and uses the same Newsreader/Geist/Geist Mono typefaces, ScreenHeader, status pills, SVG icons, Almanac mark and fitted domain artwork. Fontsource packages supply local font files and licences; the bundle does not depend on a font CDN. Workspace CSS provides layout and controls using shared tokens rather than a second palette. It makes no server request to render the interface. The browser review surface is `/local-workspace`, outside the existing web layout so it has one navigation bar. Browser cold launch still needs the Next.js server; an already-open workspace reads and edits offline. A browser service worker is outside this slice.

## Sync contract and compatibility

Authenticated `GET /api/local-workspace` returns protocol version 1, installation identity, all domains/projects/tasks and workflow definitions in one repeatable-read database transaction. Empty containers and task sets larger than 500 are covered. Full downloads are intentional for this first slice; incremental sync is a later optimization.

A queued task operation includes its immutable operation ID, server version, installation identity, patch and original field values. The server checks these under its existing task lock and records the result transactionally. Lost replies replay the same operation; they cannot duplicate completion side effects. Existing clients that omit the base retain strict version-conflict behavior. Existing frozen iOS operations are never rewritten.

Legacy snapshots decode with optional domain/project arrays. Old captures, recordings and queues remain in their existing directories. Snapshot replacement is atomic. A changed server identity pauses delivery and preserves the old workspace. Deleted records with local changes stay in the pending list. There is no silent deletion or eviction of unsent work.

## Scope and rollout

This is the first milestone, not the full local-first migration. The approved Agenda layout, AI Focus selection, calendar/journal/maintenance records, record creation/moves/deletion, linked media downloads and per-install media retention controls remain future slices. Priority is preserved and mergeable but is not exposed as a new editor control.

Agenda and Other tools currently open the existing web platform (Safari on iOS). Maintenance-required details link to the existing online screen. These destinations need connectivity. The old task shortcut and Share Extension retain their previous queue behavior.

Deploy this API before installing the new app, then link and synchronize once. An older API leaves existing saved data intact and explains that workspace support is required. Bundled UI changes require an iOS build; server contract additions should remain backward compatible. This work is based on the offline foundation in PR #102 and should be reviewed as a dependent change.

## Validation

```sh
pnpm install
pnpm --filter @jevi-ops/web typecheck
pnpm --filter @jevi-ops/api typecheck
pnpm --filter @jevi-ops/web test
pnpm --filter @jevi-ops/api test -- test/local-workspace.test.ts test/offline-task-edits.test.ts test/task-workflows.test.ts
cd apps/ios
make generate
# Select an installed simulator from xcrun simctl list devices available.
xcodebuild -project JeviOps.xcodeproj -scheme APIClientTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' -derivedDataPath build/Checks DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- test
xcodebuild -project JeviOps.xcodeproj -scheme OfflineUITests -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' -derivedDataPath build/Checks DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- test
```

API tests use the disposable test database. Offline UI tests use a separate fixture store with network access disabled; they do not contact the owner's server or overwrite owner data. Coverage includes empty containers, local edits and capture across relaunch, retry identity, field conflicts, stale browser drafts and recovery navigation.

Physical-phone acceptance still needs a first sync against the deployed API, airplane-mode cold launch/edit/relaunch, then reconnect and confirmation of the same changes on web. Also exercise an intentional same-field conflict and existing recordings. Simulator and mocked-network checks do not substitute for that final device run.
