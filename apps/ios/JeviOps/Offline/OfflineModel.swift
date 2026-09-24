import Foundation
import Combine
import Network
import AVFoundation

extension APIClient {
    func offlineSnapshot() async throws -> TaskSnapshot {
        struct Tasks: Decodable { let tasks: [OfflineTask]; let next_cursor: String? }
        struct Workflows: Decodable { let scopes: [OfflineWorkflow] }
        let identity = try await syncIdentity()
        var tasks: [OfflineTask] = []
        var cursor: String?
        repeat {
            let suffix = cursor.map { "&before_id=\($0)" } ?? ""
            let page: Tasks = try await send("GET", "/api/tasks?offline_page=1" + suffix)
            tasks.append(contentsOf: page.tasks)
            cursor = page.next_cursor
        } while cursor != nil
        async let workflows: Workflows = send("GET", "/api/task-workflows")
        return try await TaskSnapshot(destination: OfflineStore.destination(for: self), tasks: tasks, scopes: workflows.scopes, identity: identity)
    }

    func syncIdentity() async throws -> SyncIdentity {
        let identity: SyncIdentity = try await send("GET", "/api/tasks/sync-state")
        guard identity.task_edit_protocol == 1 else { throw OfflineError.invalidReceipt }
        return identity
    }

    func sendEdit(_ edit: PendingTaskEdit) async throws -> OfflineTask {
        guard let identity = edit.identity else { throw OfflineError.destinationChanged }
        let data = try await sendRaw("PATCH", "/api/tasks/\(edit.task.id)", bodyData: edit.body, expectsJSON: true,
            headers: ["x-operation-id": edit.id.uuidString.lowercased(), "x-task-version": edit.base.updated_at, "x-sync-identity": identity.header])
        var task = try JSONDecoder().decode(OfflineTask.self, from: data)
        task.project = edit.base.project
        task.domain = edit.base.domain
        return task
    }

    func deliver(_ capture: LocalCapture, recording: Data?) async throws {
        guard let body = capture.createBody else { throw OfflineError.invalidStoredCapture }
        let data = try await sendRaw("POST", "/api/captures", bodyData: body, expectsJSON: true)
        let acknowledgement = try JSONDecoder().decode(CaptureAcknowledgement.self, from: data)
        guard acknowledgement.receipt.capture_id == capture.id else { throw OfflineError.invalidReceipt }
        if acknowledgement.receipt.storage_state == "complete", acknowledgement.receipt.receipt_kind == "server_saved" { return }
        guard let attachment = capture.attachmentID, let recording, let finalize = capture.finalizeBody else {
            throw OfflineError.invalidReceipt
        }
        _ = try await sendRaw("PUT", "/api/capture-uploads/\(attachment.uuidString.lowercased())", bodyData: recording,
                             expectsJSON: true, timeout: 120, contentType: "application/octet-stream")
        let finalData = try await sendRaw("POST", "/api/captures/\(capture.id.uuidString.lowercased())/finalize",
                                        bodyData: finalize, expectsJSON: true)
        let final = try JSONDecoder().decode(CaptureAcknowledgement.self, from: finalData)
        guard final.receipt.capture_id == capture.id, final.receipt.storage_state == "complete",
              final.receipt.receipt_kind == "server_saved" else { throw OfflineError.invalidReceipt }
    }
}

/// Only the main app owns this store and sender. Re-entrant foreground,
/// reconnect and button requests join one serial sender; the Share Extension
/// continues to use its separate legacy task queue.
@MainActor
final class OfflineModel: ObservableObject {
    @Published private(set) var captures: [LocalCapture] = []
    @Published private(set) var edits: [PendingTaskEdit] = []
    @Published private(set) var snapshot: TaskSnapshot?
    @Published private(set) var storageError: String?
    @Published private(set) var connectionMessage: String?
    @Published private(set) var syncing = false
    @Published private(set) var refreshing = false
    @Published private(set) var networkAvailable = true
    @Published private(set) var recordingID: UUID?
    @Published private(set) var recordingMessage: String?

    let store: OfflineStore?
    private let monitor = NWPathMonitor()
    private var recorder: AVAudioRecorder?
    private var recordingTimer: Timer?
    private var interruptionObserver: NSObjectProtocol?
    private var lastAttempt = Date.distantPast
    private let automaticSync: Bool
    private var fixtureClient: APIClient?
    private var configuredClient: APIClient? { fixtureClient ?? APIClient.forDevice }

    #if DEBUG
    func useOfflineFixture(client: APIClient) {
        fixtureClient = client
        networkAvailable = false
        loadSnapshot(client: client)
    }
    #endif

    init(store supplied: OfflineStore? = nil, monitorNetwork: Bool = true) {
        automaticSync = monitorNetwork
        do { store = try supplied ?? OfflineStore.applicationStore() }
        catch { store = nil; storageError = error.localizedDescription }
        reload()
        if monitorNetwork {
            monitor.pathUpdateHandler = { [weak self] path in
                Task { @MainActor in
                    guard let self else { return }
                    let reconnected = !self.networkAvailable && path.status == .satisfied
                    self.networkAvailable = path.status == .satisfied
                    if reconnected { await self.refresh() }
                }
            }
            monitor.start(queue: DispatchQueue(label: "jeviops.offline.network"))
            interruptionObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
            ) { [weak self] _ in Task { @MainActor in self?.stopRecording() } }
        }
    }

    deinit {
        monitor.cancel()
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
    }

    func reload() {
        guard let store else { return }
        let result = store.load()
        captures = result.captures
        storageError = result.errors.isEmpty ? nil : result.errors.joined(separator: "\n")
        do { edits = try store.loadEdits() }
        catch { storageError = "A queued task edit could not be read. Its file is preserved. \(error.localizedDescription)" }
    }

    @discardableResult
    func saveNote(_ text: String, client: APIClient? = nil) throws -> UUID {
        let client = client ?? configuredClient
        guard let store else { throw OfflineError.invalidStoredCapture }
        var capture = LocalCapture(text: text.trimmingCharacters(in: .whitespacesAndNewlines))
        if let client, client.bearer != nil { capture.destination = OfflineStore.destination(for: client) }
        capture.serverIdentity = snapshot?.identity
        try capture.prepare()
        try store.save(capture)
        reload()
        if automaticSync { Task { await sendPending() } }
        return capture.id
    }

    func startRecording(note: String) async throws {
        guard recordingID == nil, let store else { return }
        guard note.utf16.count <= 20_000 else { throw OfflineError.tooLong }
        let allowed = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
        }
        guard allowed else {
            recordingMessage = "Microphone access is off. Enable it in iOS Settings to record; typed notes still work."
            return
        }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        var capture = LocalCapture(text: note.trimmingCharacters(in: .whitespacesAndNewlines), hasRecording: true)
        if let client = APIClient.forDevice, client.bearer != nil { capture.destination = OfflineStore.destination(for: client) }
        // Persist the manifest BEFORE opening the recording. A crash leaves a
        // visible recovery item, never an invisible orphan or a false receipt.
        try store.save(capture)
        let newRecorder = try AVAudioRecorder(url: store.recordingURL(capture.id), settings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsFloatKey: false
        ])
        guard newRecorder.record(forDuration: 600) else {
            reload()
            throw OfflineError.invalidStoredCapture
        }
        recorder = newRecorder
        recordingID = capture.id
        recordingMessage = nil
        recordingTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.recorder?.isRecording == false { self.stopRecording() }
            }
        }
        reload()
    }

    func stopRecording() {
        guard let id = recordingID else { return }
        recorder?.stop()
        recorder = nil
        recordingTimer?.invalidate()
        recordingTimer = nil
        recordingID = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        do {
            try recoverRecording(id)
            recordingMessage = "Recording saved on this phone."
        } catch { recordingMessage = error.localizedDescription }
    }

    func recoverRecording(_ id: UUID) throws {
        guard let store, var capture = captures.first(where: { $0.id == id }), !capture.recordingFinished else { return }
        let url = store.recordingURL(id)
        let audio = try AVAudioFile(forReading: url)
        guard audio.length > 0 else { throw OfflineError.emptyCapture }
        try capture.prepare(recording: Data(contentsOf: url))
        capture.recordingFinished = true
        try store.save(capture)
        reload()
        if automaticSync { Task { await sendPending() } }
    }

    func loadSnapshot(client: APIClient? = nil) {
        let client = client ?? configuredClient
        snapshot = nil
        guard let store, let client, client.bearer != nil else { return }
        do { snapshot = try store.snapshot(for: OfflineStore.destination(for: client)) }
        catch { storageError = "The task snapshot could not be read. \(error.localizedDescription)" }
    }

    func pendingEdit(for task: OfflineTask) -> PendingTaskEdit? {
        edits.first { $0.task.id == task.id && $0.destination == snapshot?.destination }
    }

    func visibleTask(_ task: OfflineTask) -> OfflineTask { pendingEdit(for: task)?.task ?? task }

    var visibleTasks: [OfflineTask] {
        guard let snapshot else { return [] }
        let ids = Set(snapshot.tasks.map(\.id))
        return snapshot.tasks.map(visibleTask) + edits.filter { $0.destination == snapshot.destination && !ids.contains($0.task.id) }.map(\.task)
    }

    func saveEdit(_ task: OfflineTask) throws {
        guard storageError == nil, let store, let snapshot, let original = snapshot.tasks.first(where: { $0.id == task.id }), snapshot.identity != nil else {
            throw OfflineError.destinationChanged
        }
        let previous = pendingEdit(for: task)
        guard previous?.attempted != true || (previous?.blocked == true && previous?.serverTask != nil) else { throw OfflineError.editInFlight }
        let edit = try PendingTaskEdit.make(base: previous?.serverTask ?? previous?.base ?? original, task: task, snapshot: snapshot)
        try store.saveEdit(edit)
        reload()
        if automaticSync { Task { await sendPending() } }
    }

    /// Only a terminal rejection can be discarded. An ambiguous request must
    /// first replay its original operation so "Use server" cannot race a write.
    func useServer(_ edit: PendingTaskEdit) throws {
        guard edit.blocked, let server = edit.serverTask else { throw OfflineError.editInFlight }
        try acceptTask(server, destination: edit.destination)
        try store?.removeEdit(edit)
        reload()
    }

    func reapplyEdit(_ edit: PendingTaskEdit) throws {
        guard edit.blocked, let server = edit.serverTask, let snapshot else { throw OfflineError.editInFlight }
        // Reapply only the fields the user changed; unrelated server updates
        // must survive even when the user chooses their local version.
        let patch = try JSONSerialization.jsonObject(with: edit.body) as? [String: Any] ?? [:]
        var desired = server
        if patch.keys.contains("title") { desired.title = edit.task.title }
        if patch.keys.contains("notes") { desired.notes = edit.task.notes }
        if patch.keys.contains("due_date") { desired.due_date = edit.task.due_date }
        if patch.keys.contains("priority") { desired.priority = edit.task.priority }
        if patch.keys.contains("status") { desired.status = edit.task.status }
        if patch.keys.contains("workflow_status_id") {
            desired.workflow_status_id = edit.task.workflow_status_id
            desired.status = edit.task.status
        }
        let replacement = try PendingTaskEdit.make(base: server, task: desired, snapshot: snapshot)
        try store?.saveEdit(replacement)
        reload()
        if automaticSync { Task { await sendPending() } }
    }

    func reviewServerVersion(_ original: PendingTaskEdit) async throws {
        guard original.blocked, let client = configuredClient,
              OfflineStore.destination(for: client) == original.destination,
              try await client.syncIdentity() == original.identity else { throw OfflineError.destinationChanged }
        let task: OfflineTask = try await client.send("GET", "/api/tasks/\(original.task.id)")
        var edit = original
        edit.serverTask = task
        try store?.saveEdit(edit)
        reload()
    }

    private func acceptTask(_ task: OfflineTask, destination: String) throws {
        guard let store, var updated = try store.snapshot(for: destination) else { throw OfflineError.invalidStoredCapture }
        updated.tasks.removeAll { $0.id == task.id }
        updated.tasks.append(task)
        try store.saveSnapshot(updated)
        if snapshot?.destination == destination { snapshot = updated }
    }

    func refresh(client: APIClient? = nil) async {
        let client = client ?? configuredClient
        loadSnapshot(client: client)
        guard !refreshing, networkAvailable, let client, client.bearer != nil else { return }
        refreshing = true
        defer { refreshing = false }
        await sendPending(client: client)
        do {
            let fresh = try await client.offlineSnapshot()
            // Settings can change during an in-flight download. Keep the
            // correctly partitioned file but never display it for a new link.
            try store?.saveSnapshot(fresh)
            if configuredClient.map({ OfflineStore.destination(for: $0) }) == fresh.destination {
                snapshot = fresh
            }
            connectionMessage = nil
        } catch { connectionMessage = "Showing saved data. \(error.localizedDescription)" }
    }

    func sendPending(client: APIClient? = nil, retryBlocked: Bool = false) async {
        let client = client ?? configuredClient
        guard !syncing, networkAvailable, let store, let client, client.bearer != nil else { return }
        syncing = true
        defer { syncing = false }
        let identity: SyncIdentity
        do { identity = try await client.syncIdentity() }
        catch {
            connectionMessage = "Sync unavailable. The server needs offline-sync support and a working connection. Local changes are safe."
            return
        }
        for original in edits where !original.blocked || retryBlocked {
            if automaticSync, configuredClient.map({ OfflineStore.destination(for: $0) }) != OfflineStore.destination(for: client) { return }
            var edit = original
            do {
                guard edit.destination == OfflineStore.destination(for: client), edit.identity == identity else { throw OfflineError.destinationChanged }
                edit.attempted = true
                try store.saveEdit(edit)
                reload()
                let server = try await client.sendEdit(edit)
                try acceptTask(server, destination: edit.destination)
                try store.removeEdit(edit)
            } catch {
                edit.error = error.localizedDescription
                edit.blocked = Self.isTerminal(error)
                if case APIError.http(let status, let body) = error, status == 409 {
                    struct Conflict: Decodable { var current: OfflineTask?; var message: String?; var item_id: UUID? }
                    if let conflict = try? JSONDecoder().decode(Conflict.self, from: Data(body.utf8)) {
                        var serverTask = conflict.current
                        serverTask?.project = edit.base.project
                        serverTask?.domain = edit.base.domain
                        edit.serverTask = serverTask
                        edit.error = conflict.message ?? edit.error
                        edit.detailsPath = conflict.item_id.map { "/maintenance/\($0.uuidString.lowercased())" }
                    }
                }
                do { try store.saveEdit(edit) }
                catch { storageError = error.localizedDescription }
                reload()
                if !edit.blocked { return }
            }
            reload()
        }
        for original in captures.reversed() where original.deliveredAt == nil && original.ready && (!original.blocked || retryBlocked) {
            if automaticSync, configuredClient.map({ OfflineStore.destination(for: $0) }) != OfflineStore.destination(for: client) { return }
            var capture = original
            do {
                let destination = OfflineStore.destination(for: client)
                guard capture.destination == nil || capture.destination == destination else { throw OfflineError.destinationChanged }
                guard capture.serverIdentity == nil || capture.serverIdentity == identity else { throw OfflineError.destinationChanged }
                capture.destination = destination
                capture.serverIdentity = identity
                // Claim a first destination durably before touching the API.
                try store.save(capture)
                let audio = capture.hasRecording ? try Data(contentsOf: store.recordingURL(capture.id)) : nil
                try await client.deliver(capture, recording: audio)
                capture.deliveredAt = Date()
                capture.deliveryError = nil
                capture.blocked = false
                try store.save(capture)
            } catch {
                capture.deliveryError = error.localizedDescription
                capture.blocked = Self.isTerminal(error)
                do { try store.save(capture) }
                catch { storageError = "Delivery state could not be saved. The next attempt will reconcile the same operation. \(error.localizedDescription)" }
                reload()
                // Network/auth failure affects the entire destination; avoid
                // hammering the server once per queued item.
                if !capture.blocked { break }
                if case APIError.http(401, _) = error { break }
            }
            reload()
        }
    }

    func foregroundTick() async {
        guard automaticSync else { return }
        guard Date().timeIntervalSince(lastAttempt) >= 60 else { return }
        lastAttempt = Date()
        await refresh()
    }

    private static func isTerminal(_ error: Error) -> Bool {
        switch error {
        case APIError.http(let status, _): return (400..<500).contains(status) && status != 429
        case OfflineError.destinationChanged: return true
        // A malformed success response or local acknowledgement-write failure
        // is ambiguous. Freeze the operation and replay it; never offer a new
        // completion operation merely because decoding/storage failed.
        default: return false
        }
    }
}
