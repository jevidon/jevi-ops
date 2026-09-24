import Foundation
import XCTest

@MainActor
final class OfflineTests: XCTestCase {
    private var root: URL!
    private var store: OfflineStore!
    private var client: APIClient!
    private var session: URLSession!
    private let identity = SyncIdentity(task_edit_protocol: 1, dataSpaceId: "11111111-2222-4333-8444-555555555555", serverEpoch: 1)

    override func setUp() {
        super.setUp()
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        store = try! OfflineStore(root: root)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OfflineTransport.self]
        session = URLSession(configuration: configuration)
        client = APIClient(baseURL: URL(string: "https://offline.example.invalid")!, bearer: "test-device", session: session)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        OfflineTransport.handler = nil
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    func testNoteSurvivesRelaunchAndDeliveredCopyIsRetained() throws {
        let model = OfflineModel(store: store, monitorNetwork: false)
        let id = try model.saveNote("Ōtaki notes", client: client)
        let reopened = try OfflineStore(root: root)
        var saved = try XCTUnwrap(reopened.load().captures.first)
        XCTAssertEqual(saved.id, id)
        XCTAssertEqual(saved.text, "Ōtaki notes")
        saved.deliveredAt = Date()
        try reopened.save(saved)
        XCTAssertEqual(reopened.load().captures.first?.text, "Ōtaki notes")
    }

    func testCorruptManifestIsVisibleAndDoesNotEraseOtherCaptures() throws {
        var valid = LocalCapture(text: "Keep me")
        try valid.prepare()
        try store.save(valid)
        let corrupt = LocalCapture(text: "Damaged manifest")
        try store.save(corrupt)
        let path = store.directory(corrupt.id).appendingPathComponent("capture.json")
        try Data("broken".utf8).write(to: path)
        let loaded = store.load()
        XCTAssertEqual(loaded.captures.map(\.id), [valid.id])
        XCTAssertEqual(loaded.errors.count, 1)
        XCTAssertEqual(try Data(contentsOf: path), Data("broken".utf8))
    }

    func testWriteFailureDoesNotClaimSaved() throws {
        try FileManager.default.removeItem(at: root)
        try Data("not a directory".utf8).write(to: root)
        XCTAssertThrowsError(try store.save(LocalCapture(text: "Cannot save")))
    }

    func testRecordingDraftAndFrozenMediaEnvelopeSurviveRestart() throws {
        var capture = LocalCapture(text: "Voice note", hasRecording: true)
        try store.save(capture)
        XCTAssertFalse(try XCTUnwrap(store.load().captures.first).ready)
        let audio = Data("test-wave-bytes".utf8)
        try audio.write(to: store.recordingURL(capture.id))
        try capture.prepare(recording: audio)
        capture.recordingFinished = true
        try store.save(capture)
        var reopened = try XCTUnwrap(store.load().captures.first)
        let frozen = reopened.createBody
        try reopened.prepare(recording: Data("different bytes must not rewrite submission".utf8))
        XCTAssertEqual(reopened.createBody, frozen)
        XCTAssertEqual(try Data(contentsOf: store.recordingURL(capture.id)), audio)
    }

    func testLostCaptureReplyRetriesExactBytesAndRetainsOriginal() async throws {
        var capture = LocalCapture(text: "Keep until receipt")
        try capture.prepare()
        try store.save(capture)
        var bodies: [Data] = []
        let id = capture.id
        OfflineTransport.handler = { request in
            if request.url!.path == "/api/tasks/sync-state" { return try self.response(self.identity, request) }
            bodies.append(try Self.body(request))
            if bodies.count == 1 { throw URLError(.networkConnectionLost) }
            return self.rawResponse(request, "{\"receipt\":{\"capture_id\":\"\(id)\",\"storage_state\":\"complete\",\"receipt_kind\":\"server_saved\"}}")
        }
        let model = OfflineModel(store: store, monitorNetwork: false)
        await model.sendPending(client: client)
        XCTAssertNil(model.captures.first?.deliveredAt)
        let restarted = OfflineModel(store: store, monitorNetwork: false)
        await restarted.sendPending(client: client)
        XCTAssertNotNil(restarted.captures.first?.deliveredAt)
        XCTAssertEqual(bodies.count, 2)
        XCTAssertEqual(bodies[0], bodies[1])
        XCTAssertEqual(restarted.captures.first?.text, capture.text)
    }

    func testTaskEditsCoalesceBeforeSendingAndPersistAcrossRestart() throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        var task = snapshot.tasks[0]
        task.title = "First change"
        try model.saveEdit(task)
        task.title = "Second change"
        task.status = "done"
        try model.saveEdit(task)
        XCTAssertEqual(model.edits.count, 1)
        let restarted = OfflineModel(store: store, monitorNetwork: false)
        restarted.loadSnapshot(client: client)
        XCTAssertEqual(restarted.visibleTask(snapshot.tasks[0]).title, "Second change")
        XCTAssertEqual(restarted.edits[0].base.title, "Original")
        XCTAssertEqual(restarted.edits[0].task.status, "done")
    }

    func testTaskRetryAfterLostReplyUsesSameIDAndVersion() async throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        var changed = snapshot.tasks[0]
        changed.status = "done"
        try model.saveEdit(changed)
        var requests: [URLRequest] = []
        OfflineTransport.handler = { request in
            if request.url!.path == "/api/tasks/sync-state" { return try self.response(self.identity, request) }
            requests.append(request)
            if requests.count == 1 { throw URLError(.timedOut) }
            return try self.response(changed, request)
        }
        await model.sendPending(client: client)
        XCTAssertTrue(model.edits[0].attempted)
        XCTAssertThrowsError(try model.saveEdit(changed))
        await model.sendPending(client: client)
        XCTAssertTrue(model.edits.isEmpty)
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "x-operation-id"), requests[1].value(forHTTPHeaderField: "x-operation-id"))
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "x-task-version"), snapshot.tasks[0].updated_at)
        XCTAssertEqual(model.snapshot?.tasks.first?.status, "done")
    }

    func testChangedCredentialsCannotReadCacheOrReplayOldEdits() async throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        var task = snapshot.tasks[0]
        task.title = "Local change"
        try model.saveEdit(task)
        var replacement = client!
        replacement.bearer = "different-device-token"
        model.loadSnapshot(client: replacement)
        XCTAssertNil(model.snapshot)
        OfflineTransport.handler = { request in
            XCTAssertEqual(request.url!.path, "/api/tasks/sync-state", "Must never send an old edit with replacement credentials")
            return try self.response(self.identity, request)
        }
        await model.sendPending(client: replacement)
        XCTAssertTrue(model.edits[0].blocked)
        XCTAssertEqual(model.edits[0].task.title, "Local change")
    }

    func testConflictReapplyPreservesUnrelatedServerNotesAndUsesNewOperation() async throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        var local = snapshot.tasks[0]
        local.title = "My title"
        try model.saveEdit(local)
        let originalOperation = model.edits[0].id
        var server = snapshot.tasks[0]
        server.notes = "New notes from another device"
        server.updated_at = "2026-09-24T02:02:03.000Z"
        OfflineTransport.handler = { request in
            if request.url!.path == "/api/tasks/sync-state" { return try self.response(self.identity, request) }
            let current = try JSONSerialization.jsonObject(with: JSONEncoder().encode(server))
            return (HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!,
                    try JSONSerialization.data(withJSONObject: ["error": "task_changed", "message": "Changed remotely", "current": current]))
        }
        await model.sendPending(client: client)
        XCTAssertTrue(model.edits[0].blocked)
        XCTAssertEqual(model.visibleTasks.first?.title, "My title")
        try model.reapplyEdit(model.edits[0])
        let replacement = try XCTUnwrap(model.edits.first)
        XCTAssertNotEqual(replacement.id, originalOperation)
        XCTAssertEqual(replacement.base.updated_at, server.updated_at)
        XCTAssertEqual(replacement.task.notes, server.notes)
        XCTAssertEqual(replacement.task.title, "My title")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: replacement.body) as? [String: Any])
        XCTAssertNil(body["notes"])
    }

    func testDeletedServerTaskDoesNotHidePendingLocalEdit() throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        var local = snapshot.tasks[0]
        local.title = "Preserved edit"
        try model.saveEdit(local)
        var empty = snapshot
        empty.tasks = []
        try store.saveSnapshot(empty)
        model.loadSnapshot(client: client)
        XCTAssertEqual(model.visibleTasks.first?.title, "Preserved edit")
    }

    func testMalformedSuccessCannotUnlockAnAmbiguousCompletionForEditing() async throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        var task = snapshot.tasks[0]
        task.status = "done"
        try model.saveEdit(task)
        let operation = model.edits[0].id
        OfflineTransport.handler = { request in
            if request.url!.path == "/api/tasks/sync-state" { return try self.response(self.identity, request) }
            return self.rawResponse(request, "{}")
        }
        await model.sendPending(client: client)
        XCTAssertEqual(model.edits[0].id, operation)
        XCTAssertTrue(model.edits[0].attempted)
        XCTAssertFalse(model.edits[0].blocked)
        XCTAssertThrowsError(try model.saveEdit(task))
    }

    private func seedSnapshot() throws -> TaskSnapshot {
        let task = OfflineTask(id: UUID().uuidString, title: "Original", status: "open", updated_at: "2026-09-24T01:02:03.000Z")
        let snapshot = TaskSnapshot(destination: OfflineStore.destination(for: client), tasks: [task], scopes: [], identity: identity)
        try store.saveSnapshot(snapshot)
        return snapshot
    }

    private func response<T: Encodable>(_ body: T, _ request: URLRequest) throws -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, try JSONEncoder().encode(body))
    }

    private func rawResponse(_ request: URLRequest, _ text: String) -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, Data(text.utf8))
    }

    private static func body(_ request: URLRequest) throws -> Data {
        if let data = request.httpBody { return data }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer { stream.close() }
        var result = Data(), buffer = [UInt8](repeating: 0, count: 1024)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count == 0 { return result }
            if count < 0 { throw stream.streamError! }
            result.append(contentsOf: buffer.prefix(count))
        }
    }
}

private final class OfflineTransport: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw URLError(.notConnectedToInternet) }
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
