# Native offline use

The app starts on a native Capture screen. Captures, Tasks & Lists, Dashboard,
and Settings are separate tabs. Pairing and the server are unnecessary for
saving notes or recording on the phone. The web Dashboard still requires a
connection.

## Available without a connection

- Save text (up to 20,000 UTF-16 units) and phone audio (mono 16 kHz WAV,
  up to 10 minutes, within the server's 25 MiB media limit).
- Search and read retained local captures; play and export recordings.
- Read all tasks downloaded by the last successful sync, grouped by their
  project/domain list, including notes, due dates and custom status labels.
- Edit titles, notes, dates, priorities, completion and existing custom
  statuses. The local view changes immediately and displays pending sync.
- Close/relaunch the app and retain captures, task snapshots and queued edits.

## Server and app rollout

Deploy the API changes from this branch before installing the new app. The
authenticated `/api/tasks/sync-state` response advertises protocol 1 and the
installation identity. The phone requires that handshake before downloading
the task snapshot or sending new captures/edits; an older server cannot silently
treat an offline edit as an unconditional PATCH. Existing web PATCH clients
keep their behavior.

Link the device and open Tasks & Lists while connected once to download data.
Later syncs download every task using opt-in UUID keyset pagination (500 per
page). The snapshot is replaced only after the full tasks/workflows download
and local write succeed. It is a last-downloaded view, not a live database
transaction spanning all pages. New tasks created during a download may appear
on the next sync. Empty lists without tasks are not represented in this view.

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
Edits to the same task coalesce until the first request. Once attempted, the
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

Sync runs serially while the app is active, on foreground/reconnection, and via
the Sync button. Periodic foreground attempts are spaced one minute apart.
Network failures, 429s and server failures retain pending work; terminal
rejections remain visible. iOS background execution and force-quit delivery are
not promised. Recording stops and attempts to save on background/interruption.

## Remaining limitations

- No on-device transcription or AI interpretation. Audio capture/playback works
  independently of transcription.
- No offline task creation in the new store, deletion, moves between projects,
  list/workflow-definition editing, recurrence-rule editing, or attachment editing.
- No cached calendar, journal, documents, maintenance pages or linked media.
- The legacy New Task shortcut and Share Extension retain their existing task
  behavior/queue; they have not migrated to this new capture store.
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
