# Native offline iOS capture — implementation plan

Prepared 17 September 2026. Base: `main` at `438db18` after PRs #51 and #52.
This document turns [the product scope](02-offline-phone-capture.md) into separate, reviewable deliveries. The existing native app is not yet an offline capture client. No feature implementation or device acceptance is claimed here.

## Release outcome

On the phone, record audio, compose text, share links, and import images, video, audio and documents without a working server. Keep captures searchable and playable after upload. Persist first, transcribe on the phone, and deliver directly to Jevi Ops using durable receipts. A capture needs at least one content part, but no project, tags or successful transcription.

The first phone release includes native recording, mixed attachments, local transcription, the local library, reliable delivery and explicit retention controls. ESP32 transfer follows this release. Automatic Hermes interpretation/routing remains the separate Gate C workstream; capture and retrieval must work while Hermes is unavailable. Shopping and task workflows are independent.

## Readiness and decisions

| Item | Evidence / decision |
| --- | --- |
| Git baseline | GitHub `main` is `438db18`; the plan branch starts there. There were no open PRs at inspection. |
| Xcode | `/Applications/Xcode.app`, version 27.0, build `27A266a`. |
| Command-line selection | `xcode-select -p` reports `/Library/Developer/CommandLineTools`. Use `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` for project commands; no global switch is required. |
| First launch | Owner completed first launch; the check now passes. iOS 27 SDK and iOS 26.5/27.0 simulator runtimes are installed. |
| Baseline build and launch | XcodeGen 2.46.0 generates the project. The existing app and Share Extension build for iPhone 17 Pro / iOS 26.5 with ad-hoc signing. A clean temporary simulator installs and launches the app to its onboarding screen; screenshot inspected. Offline capture is not implemented. |
| Device and languages | Owner identified iPhone 17 Pro; a read-only device probe confirms iOS 26.6.1 (`23G83`) with Developer Mode enabled. Language selection is pending. |
| Compatibility | Existing app targets iOS 17. Recommend iOS 26+ and Apple on-device speech for the first native capture release; owner approval of the new minimum and language scope is pending. Hardware/locale checks and a real offline transcription still gate release. |
| Signing | Real-device App Group and shared Keychain entitlements must be provisioned with the owner's team. No signing identity or existing credentials were changed. |
| Server environment | The older Gate B report contains historical environment observations. Verify the intended test server, private media directory, migration status and capture-token scopes again; do not apply its old rollback instructions automatically. |

The build-tooling gate is resolved. The support-floor/language decision and a physical-phone transcription probe remain gates for speech implementation. Storage and contract work can begin independently.

## Existing code to reuse and gaps to close

| Area | Existing entry point | Required work |
| --- | --- | --- |
| Native navigation | `apps/ios/JeviOps/App/RootView.swift` | Native Capture and Recent Captures remain reachable before pairing and when the web shell fails. Keep Dashboard and explicit task creation available. |
| Shared storage | `apps/ios/Shared/AppConfig.swift` | Add an App Group database/media store. The current fallback to Caches must never be used to claim durable capture. |
| Offline tasks | `apps/ios/Shared/PendingQueue.swift` | Preserve the old queue and its explicit task intent; eliminate silent rejection loss and concurrent read/modify/write races during migration. |
| Share Sheet | `apps/ios/ShareExtension/ShareViewController.swift` | Handle all advertised content parts, persist file representations before extension completion, and share the native capture composer/store. |
| Credentials/network | `Shared/APIClient.swift`, `Shared/KeychainStore.swift`, onboarding | Use a separate scoped capture token and receipt-aware transport. Preserve the existing task token while legacy task actions still need it. |
| Shared contract | `packages/shared/src/schemas/durable-capture.ts` and fixture directory | V1 is strict: text cannot contain attachments; audio/image MIME allowlist; four attachments, 25 MiB each; 20,000 text characters. Broaden with an explicitly versioned contract. |
| API/storage | `apps/api/src/routes/captures.ts`, `lib/capture/{service,ledger,digest,media-store}.ts` | Reuse receipt ledger, authentication and private storage. Add capability negotiation, mixed content, resumable media, and explicit correction/lifecycle commands. |
| Current interpretation | `apps/api/src/lib/capture/legacy-bridge.ts` | A V2 or reference-only capture must not be blindly interpreted by the V1 bridge. Keep unsupported processing pending or explicitly unsupported while its original content remains readable. |

## Proposed implementation choices

These are defaults for implementation, not claims about existing functionality.

### Native storage and navigation

- SwiftUI native entry points: Capture, Recent Captures, Dashboard, and visible Settings. Capture and the library are usable without signing in; pairing is required for delivery only. Keep `jeviops://new-task` and current task shortcuts working with their existing meaning. Add separate capture routes/shortcuts.
- A small SQLite store using the platform `SQLite3` module, in the App Group container, with versioned migrations, WAL, foreign keys and durable transactions. Use an actor within each process and SQLite transactions/leases across the app and Share Extension; an actor alone does not coordinate two processes.
- Tables cover captures/revisions, content parts, retained files, transcription jobs, delivery operations, upload progress, server receipts, search index and legacy queue import records. Keep storage, transcription, delivery and review state separate.
- Put media under generated relative identifiers. Write staging files, sync and atomically rename, then commit their database references. Recover staged/incomplete/orphaned files on startup. Never mark a file saved before bytes and metadata are durable. If the shared container or storage is unavailable, report the failure and preserve the available source.
- Search indexes notes, final transcripts, filenames and URLs. It must return delivered and pending captures while offline. Keep previews optional; stream large files rather than loading entire videos into memory.
- Archive is local visibility and leaves delivery running. Removing a delivered local file retains metadata/search text and marks that file unavailable offline. No automatic deletion of unsent content. “Delete capture” has explicit local/server progress and never deletes a derived task implicitly.

### Compatibility and capture V2

- Keep V1 schemas, endpoints, fixtures and existing web/Hermes clients valid. Introduce `protocol_version: 2` for a manifest of ordered text/link/attachment parts, original filenames, recorded modality, and optional transcript provenance. Reserve stable part and attachment IDs.
- Add an authenticated capture-capabilities response with supported versions, operations, MIME types, limits, resumable-upload support, `data_space_id` and `server_epoch`. The phone checks it before delivery. An older server can receive representable V1 captures; unsupported mixed content stays saved locally with a clear upgrade requirement. Never silently discard parts or fabricate placeholder text.
- Preserve original content separately from edited notes and derived transcripts. Define an explicit reference disposition before exposing “Keep for reference” as a promise. All interpretation paths must honor it; `capture_only` alone is not a reference-only instruction.
- Keep local edits mutable before submission. Persist the exact envelope bytes, command/operation ID, timestamps and manifest before the first request. Freeze them on first attempt. Lost responses replay the same command or reconcile its receipt.
- Add a revision-checked amendment command for late transcripts/corrections to the same capture. New amendments get their own operation ID and expected revision; they do not rewrite the original submission or automatically repeat downstream actions.
- Add cancellation/deletion semantics with a durable tombstone and explicit cleanup status. Preserve operation receipts so an old request cannot resurrect a deleted capture. A deletion racing submission first reconciles submission. File deletion is retryable cleanup; do not claim byte removal until it is verified.
- Use the existing `operation_receipts` ledger. Shared TypeScript/Python fixtures gain V2 cases; Swift decodes the same fixtures. Test non-ASCII text, timestamps, omitted/null fields, operation-ID conflicts and exact frozen-envelope retries.
- API schema additions follow the repository's migration/Drizzle/bootstrap triple-sync rule and populated-upgrade tests. Allocate the next migration number when implementation starts; do not reserve a number in this plan.

### Media transfer and limits

- Proposed initial limits: 8 attachments, 250 MiB per file, 1 GiB per capture, and 4 MiB upload chunks. Keep V1's existing limits unchanged. Advertise the actual configured server limits and check them before reserving/uploading files.
- Initial phone library budget: 2 GiB, with a visible warning at 80% and a 250 MiB free-space reserve. These are configurable policy defaults to validate on the target phone. Stop cleanly when limits are reached; never evict pending captures to make room. Disk-capacity checks supplement, not replace, write-error handling.
- Extend private media storage with a persisted upload session/chunk map keyed by the reserved attachment. Expose upload progress and bounded idempotent chunk writes. Repeated identical chunks succeed; conflicting bytes, invalid offsets and unauthorized reservations fail. Verify complete length and whole-file hash before publishing a file.
- Stream assembly, hashing and authenticated download. Do not increase the current in-memory whole-file parser limit to handle large videos. Unknown file types are stored as opaque downloads; preview only supported types. MIME declarations/filenames do not authorize active content execution or path selection.
- Capture finalization waits for every selected part. Allow a small text capture to finish while another capture uploads a large file. Persist each upload offset/result so app termination and server restart resume safely.

### Delivery, credentials and recovery

- Pair via an owner-authorized flow that mints `capture_client` credentials with `capture:read` and `capture:write`. Store the token in the shared Keychain, verify the write succeeded, and never put it in defaults, logs or fixture files.
- Persist a destination association for each outbox item. A changed base URL, `data_space_id` or `server_epoch` requires reconciliation; never retarget or replay the entire queue blindly against a new/restored installation.
- Existing capture access is credential-bound. Token replacement must not silently create duplicate captures because a new token cannot see the old receipt. Preserve the queue and show re-pairing/reconciliation required; an owner-authorized recovery path must be specified and tested before claiming transparent token rotation.
- Retry timeouts, offline errors, 429 and transient 5xx responses with bounded exponential backoff and jitter. Pause delivery for authentication failure. Keep permanently rejected content with its reason and correction/export actions. No “drop all 4xx” behavior.
- Persist leases so only one sender owns an operation at a time. Share extensions save locally and signal available work; the main app owns reconciliation and delivery. Use file-backed background URLSession uploads where supported, with distinct session identifiers and the shared-container identifier. Foreground launch/retry is the guaranteed recovery path.
- Source-file and capture metadata survive delivery. An audio transcript receipt does not mean original audio was uploaded. Show exactly which selected parts are stored on the server.

### Existing pending tasks

- Snapshot and import `pending-tasks.json` transactionally with a journal and a retained backup. Preserve its exact task payloads/routing. Stop the old uncoordinated flusher before migration, and serialize extension writes during the transition.
- Imported entries remain explicit task work; do not silently convert them into reference captures. The old task endpoint has no reliable replay identity. Entries with uncertain delivery need review instead of automatic resubmission. A future retry-safe task command can resolve that limitation separately.
- Prove repeated migration, a corrupt old file, concurrent extension activity and a crash between import and backup acknowledgement. Never replace an unreadable queue with an empty queue.

### Recording and speech engine

- Record directly to persistent files with AVFoundation. Save recoverable audio regardless of transcription availability. Treat calls, audio-route changes, permission refusal, insufficient storage and app termination as distinct states. Finalize or recover interrupted recordings; do not mark an unfinished file delivered.
- Decode/transcribe saved audio through a `LocalTranscriber` interface. Persist jobs, final results, engine/model/locale metadata and errors. Preserve user edits separately from engine output. Restart interrupted jobs without appending duplicate transcript segments.
- Engine gate: probe Apple `SpeechTranscriber.isAvailable`, supported/installed locales and model provisioning on the actual phone; compare representative recordings with a pinned WhisperKit model if device/language/OS requirements call for it. Select one production engine for the first release; test doubles are for simulator automation only.
- Apple's APIs require runtime hardware/locale checks and model assets. Download with visible progress before claiming offline readiness, then prove transcription with network disabled. If an Apple-only implementation requires raising the current minimum OS, obtain the owner's compatibility decision first. [Apple API](https://developer.apple.com/documentation/speech/speechtranscriber), [implementation overview](https://developer.apple.com/videos/play/wwdc2025/277/).
- For WhisperKit, pin package and model/tokenizer artifacts and verify hashes, licence and fully offline loading. Do not add a hosted fallback. [Upstream package](https://github.com/argmaxinc/argmax-oss-swift).
- Retain over-limit transcripts and show the limit. The initial server text limit remains 20,000 characters unless explicitly extended with corresponding storage/read-model tests; never truncate silently.
- Record the supported behavior for screen lock, ordinary backgrounding and force-quit separately. Background delivery/transcription is opportunistic; it cannot be promised continuously. [Apple background-transfer guidance](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background).

## Reviewable PR sequence

Branch names below are proposed implementation names, not existing PRs. Each PR must describe its partial capability and unmet release gates.

| Slice | Branch | Deliverable and dependencies | Required proof |
| --- | --- | --- | --- |
| P0 — Build and test foundation | `codex/ios-capture-foundation` | Reproducible simulator build; test target independent of owner services; fixture API server; correct App Group/Keychain signing instructions; local environment doctor. | Existing app builds/launches; offline tests do not mint tokens in the owner's database; Keychain/App Group smoke checks pass. |
| P1 — Durable native text capture | `codex/ios-capture-store` | Depends on P0. SQLite migrations/recovery, native navigation, unpaired text/link capture, Recent Captures/search, legacy task queue preservation. Networking uses a test adapter initially. | Kill/relaunch preserves content; concurrent app/extension writes do not lose entries; corrupt/full-store paths are visible; repeated legacy migration preserves every task. |
| P2 — Capture V2 and resumable media | `codex/capture-v2-media` | Server/shared fixtures, capabilities, manifests, reference disposition, revisions/amendments, lifecycle receipts, chunk uploads and authenticated reads. May be developed alongside P1. | V1 regressions, cross-language fixtures, owner isolation, lost replies, interrupted assembly, finalize races, cancel/delete replay and populated upgrade pass. |
| P3 — Native recording, files and Share Sheet | `codex/ios-capture-inputs` | Depends on P1; P2 contract fixtures define the content model. Recording, mixed-content composition, attachment-only capture, safe imports, previews/playback, storage controls and Share Sheet activation rules. | Phone-only recording; offline PDF/photo/video/link/mixed import; extension completion after durable copy; interruptions and missing cloud files preserve honest state. |
| P4 — Receipt-aware delivery | `codex/ios-capture-delivery` | Depends on P1/P2/P3. Scoped pairing, immutable outbox, resume/finalize, retry classification, receipt reconciliation, late corrections and explicit deletion. | Server commit with lost response creates one capture; large upload resumes; text is not blocked by another upload; revoked credentials/changed server identity preserve content. |
| P5 — Local transcription and release acceptance | `codex/ios-capture-transcription` | Depends on P3, with amendment delivery from P4 and the device/engine decision. Provisioning, durable transcription jobs, transcript review and offline-ready checks. | Physical phone completes record → local save → offline transcription → reconnect → receipt, then offline search/playback after delivery. |

P0–P5 together constitute the first phone release. ESP32 pairing/manifest/chunk import and background optimization are subsequent PRs. Gate C consumes finalized captures independently and must retain source links and reference intent.

## Acceptance record

Use separate entries for a code test, simulator proof, physical-phone proof, and deployed-server proof. Record commit, device/OS, engine/model/locale, network conditions, result and evidence. Do not substitute a successful simulator build for offline speech verification.

| Scenario | Minimum evidence before release |
| --- | --- |
| Unpaired/offline capture | Cold launch without web/API/Hermes, save text and phone recording, terminate/relaunch, content remains. |
| Local transcription | Provision assets, disable Wi-Fi/cellular, transcribe short and long representative recordings, edit transcript, recover an interrupted job. |
| Mixed content | Attachment-only photo/PDF/video, link alone, and mixed capture survive restart with original bytes and metadata. |
| Durable transfer | Interrupt chunk upload and response receipt separately; resume; compare hashes; one final capture and no duplicate operation effects. |
| Destination/credential change | Revoke token or change server identity; queued content remains, correct recovery is explicit, and nothing is silently resent elsewhere. |
| Delivered offline library | Turn server/network off after delivery; search notes/transcripts/filenames/URLs and open retained files; remove only a delivered local file and verify its availability label. |
| Corrections and deletion | Reconcile in-flight operations, attach a late transcript to the original capture, retry cancellation/deletion, preserve tombstones and derived tasks. |
| Storage and permissions | Missing App Group, permission denial, full disk, failed rename/commit and unavailable cloud files never produce a false “saved” result. |
| Existing behavior | Old queued tasks, explicit New Task shortcuts, web sign-in and task creation retain their meaning. |
| Background behavior | Measure ordinary backgrounding, screen lock, force-quit, extension timeout and reconnect on physical hardware; document actual guarantees. |

## Commands and current validation

From `apps/ios`, with Xcode first launch complete:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -version
xcodebuild -checkFirstLaunchStatus
xcodebuild -showsdks
xcrun simctl list devices available
make generate
xcodebuild -project JeviOps.xcodeproj -scheme JeviOps \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5" \
  -derivedDataPath build/DerivedData DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- build
```

Open the generated `apps/ios/JeviOps.xcodeproj` in Xcode for device/team setup. Configure the App Group for the app and Share Extension before device testing. Keep signing files and tokens out of Git. The existing README calls the simulator build unsigned, but `KeychainStore.swift` requires ad-hoc signing with entitlements; P0 must reconcile that documentation and verify the runtime behavior.

The current `make test` exercises live onboarding and can mint a token in its configured server. P0 replaces that dependency with an isolated fixture service for automated tests. Do not run the old suite against the owner's environment merely to establish build readiness.

Validated during planning: repo/API/native source inspection; GitHub baseline; Xcode first launch and SDK/runtime inventory; paired phone model/OS/Developer Mode; XcodeGen project generation; simulator build of the existing app and Share Extension; installation and launch in a clean temporary iPhone 17 Pro / iOS 26.5 simulator. The onboarding screen was visually inspected. The build log and screenshot are local at `apps/ios/build/baseline-build.log` and `apps/ios/build/baseline-launch.png` in the plan worktree. The temporary simulator was removed afterward. No owner-server integration tests or real-device app installation were performed. The outstanding owner choices are iOS 26+ compatibility and transcription languages; physical-device signing and an actual offline speech test remain release gates.
