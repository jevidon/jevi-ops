import Foundation
import CryptoKit

/// Main-app-only storage. Each capture has its own atomic manifest so saving
/// a new item never rewrites or deletes another item. The old share queue is
/// deliberately untouched. Application Support survives cache eviction.
struct OfflineStore {
    let root: URL

    static func applicationStore() throws -> OfflineStore {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true)
        return try OfflineStore(root: support.appendingPathComponent("Offline", isDirectory: true))
    }

    init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    func directory(_ id: UUID) -> URL { root.appendingPathComponent(id.uuidString, isDirectory: true) }
    func recordingURL(_ id: UUID) -> URL { directory(id).appendingPathComponent("recording.wav") }

    func saveEdit(_ edit: PendingTaskEdit) throws {
        try JSONEncoder().encode(edit).write(to: editURL(edit.task.id), options: .atomic)
    }

    func removeEdit(_ edit: PendingTaskEdit) throws {
        try FileManager.default.removeItem(at: editURL(edit.task.id))
    }

    private func editURL(_ taskID: String) -> URL {
        root.appendingPathComponent("edit-\(OfflineStore.digest(Data(taskID.utf8))).json")
    }

    func loadEdits() throws -> [PendingTaskEdit] {
        try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("edit-") && $0.pathExtension == "json" }
            .map { try JSONDecoder().decode(PendingTaskEdit.self, from: Data(contentsOf: $0)) }
    }

    func save(_ capture: LocalCapture) throws {
        let folder = directory(capture.id)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(capture).write(to: folder.appendingPathComponent("capture.json"), options: .atomic)
    }

    func load() -> (captures: [LocalCapture], errors: [String]) {
        var captures: [LocalCapture] = []
        var errors: [String] = []
        do {
            for folder in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
                guard let id = UUID(uuidString: folder.lastPathComponent) else { continue }
                do {
                    let data = try Data(contentsOf: folder.appendingPathComponent("capture.json"))
                    let capture = try JSONDecoder().decode(LocalCapture.self, from: data)
                    guard capture.id == id else { throw OfflineError.invalidStoredCapture }
                    captures.append(capture)
                } catch {
                    errors.append("A saved capture could not be read (\(id.uuidString.prefix(8))). Its files have been preserved.")
                }
            }
        } catch { errors.append(error.localizedDescription) }
        return (captures.sorted { $0.createdAt > $1.createdAt }, errors)
    }

    func saveSnapshot(_ snapshot: TaskSnapshot) throws {
        try JSONEncoder().encode(snapshot).write(to: snapshotURL(snapshot.destination), options: .atomic)
    }

    func snapshot(for destination: String) throws -> TaskSnapshot? {
        let url = snapshotURL(destination)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let snapshot = try JSONDecoder().decode(TaskSnapshot.self, from: Data(contentsOf: url))
        guard snapshot.destination == destination else { throw OfflineError.destinationChanged }
        return snapshot
    }

    private func snapshotURL(_ destination: String) -> URL {
        root.appendingPathComponent("tasks-\(destination).json")
    }

    static func destination(for client: APIClient) -> String {
        // Store a digest, never a bearer token. A re-link or URL change cannot
        // silently upload an old outbox or display another account's snapshot.
        digest(Data((client.baseURL.absoluteString + "\n" + (client.bearer ?? "")).utf8))
    }

    static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

enum OfflineError: LocalizedError {
    case invalidStoredCapture, emptyCapture, tooLong, audioLimit, destinationChanged, invalidReceipt, editInFlight

    var errorDescription: String? {
        switch self {
        case .invalidStoredCapture: return "The local capture could not be read. Its files are preserved."
        case .emptyCapture: return "Add a note or a recording before saving."
        case .tooLong: return "Notes can contain up to 20,000 characters. Your text is still here."
        case .audioLimit: return "The recording must be between 1 byte and 25 MiB. Its local file is preserved."
        case .destinationChanged: return "Delivery paused: this capture belongs to a different server or device link. Its local copy is safe."
        case .invalidReceipt: return "The server did not confirm this capture. Its local copy is safe; retry to reconcile delivery."
        case .editInFlight: return "This task has an edit awaiting confirmation. Reconnect and resolve it before making another edit."
        }
    }
}

struct LocalCapture: Codable, Identifiable {
    var id = UUID()
    var createdAt = Date()
    var text: String
    var hasRecording = false
    var recordingFinished = false
    var destination: String?
    var serverIdentity: SyncIdentity?
    var createBody: Data?
    var finalizeBody: Data?
    var attachmentID: UUID?
    var deliveredAt: Date?
    var deliveryError: String?
    var blocked = false

    var title: String { text.isEmpty ? "Voice recording" : String(text.prefix(100)) }
    var ready: Bool { !hasRecording || recordingFinished }

    /// Freeze the exact bytes before the first network request. Every retry
    /// reuses these IDs, timestamp, hash and body, including after relaunch.
    mutating func prepare(recording: Data? = nil) throws {
        guard createBody == nil else { return }
        guard !text.isEmpty || hasRecording else { throw OfflineError.emptyCapture }
        guard text.utf16.count <= 20_000 else { throw OfflineError.tooLong }
        var payload: [String: Any] = [
            "capture_id": id.uuidString.lowercased(), "kind": hasRecording ? "audio" : "text",
            "intent": "capture_only", "modality": hasRecording ? "spoken" : "typed",
            "captured_at": ISO8601DateFormatter().string(from: createdAt),
            "time_zone": TimeZone.current.identifier,
            "client": ["name": "ios", "version": "0.1.0", "surface": "native-offline"],
            "attachments": []
        ]
        if !text.isEmpty { payload["text"] = text }
        if hasRecording {
            guard let recording, !recording.isEmpty, recording.count <= 26_214_400 else { throw OfflineError.audioLimit }
            let attachment = UUID()
            attachmentID = attachment
            payload["attachments"] = [["attachment_id": attachment.uuidString.lowercased(), "media_type": "audio/wav",
                                        "size_bytes": recording.count, "sha256": OfflineStore.digest(recording)]]
        }
        createBody = try JSONSerialization.data(withJSONObject: ["protocol_version": 1,
            "operation_id": UUID().uuidString.lowercased(), "command": "capture.create", "payload": payload], options: .sortedKeys)
        finalizeBody = try JSONSerialization.data(withJSONObject: ["protocol_version": 1,
            "operation_id": UUID().uuidString.lowercased(), "command": "capture.finalize",
            "payload": ["capture_id": id.uuidString.lowercased()]], options: .sortedKeys)
    }
}

struct OfflineTask: Codable, Identifiable {
    struct Ref: Codable { let id: String; let name: String }
    let id: String
    var title: String
    var status: String
    var notes: String?
    var due_date: String?
    var project_id: String?
    var domain_id: String?
    var workflow_status_id: String?
    var project: Ref?
    var domain: Ref?
    var updated_at: String = ""
    var priority: Int = 4
    var listID: String { project.map { "project:\($0.id)" } ?? domain.map { "domain:\($0.id)" } ?? "inbox" }
    var listName: String { project?.name ?? domain?.name ?? "Inbox" }
}

struct OfflineWorkflow: Codable {
    struct Definition: Codable {
        struct Status: Codable { let id: String; let label: String; let category: String }
        let statuses: [Status]
    }
    let id: String
    let scope: String
    let definition: Definition?
    var revision: Int = 0
}

struct TaskSnapshot: Codable {
    let destination: String
    var fetchedAt = Date()
    var tasks: [OfflineTask]
    let scopes: [OfflineWorkflow]
    var identity: SyncIdentity?

    func workflow(for task: OfflineTask) -> OfflineWorkflow? {
        scopes.first { $0.scope == (task.project_id == nil ? "domain" : "project") && $0.id == (task.project_id ?? task.domain_id) }
    }

    func statusLabel(for task: OfflineTask) -> String {
        let definition = scopes.first { $0.scope == (task.project_id == nil ? "domain" : "project") &&
            $0.id == (task.project_id ?? task.domain_id) }?.definition
        let status = definition?.statuses.first { $0.id == task.workflow_status_id }
            ?? definition?.statuses.first { $0.category == task.status }
        return status?.label ?? task.status.capitalized
    }
}

struct SyncIdentity: Codable, Equatable {
    let task_edit_protocol: Int
    let dataSpaceId: String
    let serverEpoch: Int
    var header: String { "\(dataSpaceId):\(serverEpoch)" }
}

struct PendingTaskEdit: Codable, Identifiable {
    var id = UUID()
    let destination: String
    let identity: SyncIdentity?
    let base: OfflineTask
    var task: OfflineTask
    let body: Data
    var attempted = false
    var blocked = false
    var error: String?
    var serverTask: OfflineTask?
    var detailsPath: String?

    static func make(base: OfflineTask, task: OfflineTask, snapshot: TaskSnapshot) throws -> PendingTaskEdit {
        var patch: [String: Any] = [:]
        if base.title != task.title { patch["title"] = task.title }
        if base.notes != task.notes { patch["notes"] = task.notes as Any? ?? NSNull() }
        if base.due_date != task.due_date { patch["due_date"] = task.due_date as Any? ?? NSNull() }
        if base.priority != task.priority { patch["priority"] = task.priority }
        if base.workflow_status_id != task.workflow_status_id, let status = task.workflow_status_id {
            patch["workflow_status_id"] = status
            patch["workflow_revision"] = snapshot.workflow(for: base)?.revision
        } else if base.status != task.status { patch["status"] = task.status }
        return try PendingTaskEdit(destination: snapshot.destination, identity: snapshot.identity, base: base, task: task,
                                   body: JSONSerialization.data(withJSONObject: patch, options: .sortedKeys))
    }
}

struct CaptureAcknowledgement: Decodable {
    struct Receipt: Decodable {
        let capture_id: UUID
        let storage_state: String
        let receipt_kind: String
    }
    let receipt: Receipt
}
