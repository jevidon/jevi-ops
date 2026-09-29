# Native offline use

The app opens on the same chrome as the mobile web app. Agenda, Domains,
Capture, Search and Settings are native and work from what the phone holds;
the More destinations render the web app and need the server. The Agenda
keeps its last downloaded briefing per server link; its inline actions
(complete, star, check-in, attention, routines, pins) need the server and
reload the briefing afterwards, except task completion for a task in the
synced snapshot, which queues offline like any other edit. Pairing is unnecessary for saving notes or
recordings; it is required to sync the workspace and to deliver captures.

## Available without a connection

- Save text (up to 20,000 UTF-16 units) and phone audio (mono 16 kHz WAV,
  up to 10 minutes, within the server's 25 MiB media limit), from the
  capture portal or by long-pressing the star.
- Search and read retained local captures; play and export recordings.
- Browse the Domains board exactly as the last sync computed it: domain
  cards with urgency pills and counts, assets, projects, content; domain and
  project pages with their stat strips; task pages.
- Edit titles, notes, due dates, priorities, completion and custom workflow
  statuses, including the task row checkbox. The local view changes
  immediately and shows "Pending sync".
- Search tasks, projects, domains and captures instantly.
- Close/relaunch the app and retain captures, the snapshot and queued edits.

## Server and app rollout

Deploy the API changes from this branch before installing the new app. Note
for web clients: every task PATCH now stamps `updated_at` itself (strictly
later than the previous value), which is what the phone's version check
compares; there was no database trigger doing this before. The
authenticated `/api/tasks/sync-state` response advertises protocol 1 and the
installation identity. The phone requires that handshake before downloading
the task snapshot or sending new captures/edits; an older server cannot silently
treat an offline edit as an unconditional PATCH. Existing web PATCH clients
keep their behavior.

Link the device and open Domains while connected once to download data. Each
sync fetches `GET /api/local-workspace`: one repeatable-read database
transaction returning the installation identity, the app timezone, every
domain (with its committed engraving or the procedural one the web falls back
to), every project, the workflow definitions, the computed Domains board
(`/api/work`), and the tasks the phone can act on — every open and waiting
task plus tasks completed in the last 30 days (`done_window_days`). Older
history stays on the server. The snapshot is replaced only after the whole
response has been persisted; a changed installation identity pauses delivery
and keeps the old snapshot.

## Queues and conflict behavior

The main app is the sole writer/sender for this store. Per-capture and per-task
atomic JSON files live in Application Support, separate from the old shared
task queue. Corrupt manifests remain on disk and produce a visible error.
Failed writes do not report successful saves. Recording creates its manifest
before opening the audio file; interrupted items offer recovery/export.

Capture envelopes, operation IDs, timestamps and hashes are persisted before
submission. Audio delivery reserves, uploads and finalizes using the existing
V1 capture API. A receipt only marks delivery complete after the server confirms
all content; original text/audio stays local. Whole-file uploads retry from the
start. There is no automatic local-content eviction.

Task edits retain the cached base version, desired values and an operation ID.
A save that changes nothing queues nothing, and reverting an unsent edit to
its base withdraws it. Edits to the same task coalesce until the first
request. The request body carries the base field values, so the server merges
edits to different fields of the same task (a stale notes edit still lands
when only the title changed elsewhere); status transitions on a stale
version always conflict because completions have side effects. Once attempted, the
operation is immutable until confirmed or rejected. The server locks the task,
checks its version, and commits the update and operation receipt in one
transaction. Replaying a lost response cannot apply the edit again or repeat a
recurring-task completion. Existing maintenance validation runs in that same
path and rolls back changes if more evidence is required.

Conflicts preserve the local edit and show the server version. Users can keep
the server version or reapply only their changed fields against the displayed
server version using a new operation. Another intervening server change causes
another conflict. Other rejections offer a fresh server-version review; required
maintenance details link to the online screen. Deleted tasks with pending edits
remain visible locally for attention.

Credentials are not stored in queue files. A digest of the API address and
device token partitions task snapshots and binds queued changes to their
original destination. Server identity/epoch changes pause delivery. Re-linking
or changing servers does not automatically retarget old entries. Unpaired
captures bind to their first delivery destination; recovery across credential
changes requires manual follow-up. Keep retained files until reconciliation.

Sync runs serially while the app is active, on foreground/reconnection, when
the Domains tab opens, on pull-to-refresh, and via Sync buttons. Periodic
foreground attempts are spaced one minute apart. Network failures, 401/403,
429 and server failures retain pending work as retryable; terminal
rejections remain visible for review. iOS background execution and force-quit delivery are
not promised. Recording stops and attempts to save on background/interruption.

## Remaining limitations

- No on-device transcription or AI interpretation. Audio capture/playback works
  independently of transcription.
- No offline task creation in the new store, deletion, moves between projects,
  list/workflow-definition editing, recurrence-rule editing, or attachment editing.
- No cached calendar, journal, documents, maintenance pages or linked media.
- The store lives in the App Group container (an older Application Support
  store is moved across once on launch), but the Share Extension still uses
  its legacy task queue; it has not migrated to this capture store yet.
- Agenda and the "More" destinations render the web app and need the server.
- No resumable chunks, mixed-file imports, background delivery, or storage
  management UI. Storage write errors are surfaced; unsent material is retained.
- Microphone interruptions, force-quit recording recovery, actual airplane mode,
  and deployed-server/device delivery need physical-phone acceptance testing.

## Isolated checks

`APIClientTests` includes native persistence and mocked-network tests. The
`OfflineUITests` scheme uses a separate debug-only store with fixture tasks and
network access disabled. It checks capture, task editing and relaunch without
onboarding or owner credentials. The fixture hooks are excluded from Release.

```sh
make generate
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project JeviOps.xcodeproj -scheme APIClientTests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath build/OfflineTests DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- test
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project JeviOps.xcodeproj -scheme OfflineUITests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath build/OfflineUI DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- test
```

API regression coverage is in `apps/api/test/offline-task-edits.test.ts` and
the existing task/workflow/maintenance suites, using the disposable local
`jeviops_test` database. No schema migration is needed; task operations reuse
the existing operation receipt ledger.
