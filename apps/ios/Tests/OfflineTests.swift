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

    func testSharedEditorRejectsAStaleLocalRevision() throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        var first = snapshot.tasks[0]
        first.title = "Already saved"
        try model.saveEdit(first, checkRevision: true)
        var stale = snapshot.tasks[0]
        stale.notes = "A stale draft"
        XCTAssertThrowsError(try model.saveEdit(stale, checkRevision: true))
        XCTAssertEqual(model.edits[0].task.title, "Already saved")
        var latest = model.edits[0].task
        latest.notes = "More notes"
        try model.saveEdit(latest, expectedRevision: model.edits[0].id.uuidString, checkRevision: true)
        XCTAssertEqual(model.edits[0].task.title, "Already saved")
        XCTAssertEqual(model.edits[0].task.notes, "More notes")
    }

    func testAuthenticationFailureRetainsRetryableFrozenOperation() async throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        var task = snapshot.tasks[0]
        task.title = "Waiting for sign in"
        try model.saveEdit(task)
        let operation = model.edits[0]
        OfflineTransport.handler = { request in
            if request.url!.path == "/api/tasks/sync-state" { return try self.response(self.identity, request) }
            return self.rawResponse(request, "{}", status: 401)
        }
        await model.sendPending(client: client)
        XCTAssertFalse(model.edits[0].blocked)
        XCTAssertTrue(model.edits[0].attempted)
        XCTAssertEqual(model.edits[0].id, operation.id)
        XCTAssertEqual(model.edits[0].body, operation.body)
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

    func testLateReviewCannotOverwriteAnAttemptedReplacement() async throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.useOfflineFixture(client: client)
        var local = snapshot.tasks[0]
        local.title = "My edit"
        var rejected = try PendingTaskEdit.make(base: snapshot.tasks[0], task: local, snapshot: snapshot)
        rejected.attempted = true
        rejected.blocked = true
        rejected.serverTask = snapshot.tasks[0]
        try store.saveEdit(rejected)
        var replacement = try PendingTaskEdit.make(base: snapshot.tasks[0], task: local, snapshot: snapshot)
        replacement.attempted = true
        let replacementID = replacement.id
        model.loadSnapshot(client: client)
        OfflineTransport.handler = { request in
            if request.url!.path == "/api/tasks/sync-state" { return try self.response(self.identity, request) }
            // The request has started. A resolved replacement is persisted before
            // the delayed response arrives, just as another UI action can do.
            try self.store.saveEdit(replacement)
            return try self.response(snapshot.tasks[0], request)
        }
        do {
            try await model.reviewServerVersion(rejected)
            XCTFail("A stale review must not write its captured operation")
        } catch OfflineError.editChanged { }
        let persisted = try XCTUnwrap(store.loadEdits().first)
        XCTAssertEqual(persisted.id, replacementID)
        XCTAssertTrue(persisted.attempted)
        XCTAssertFalse(persisted.blocked)
        XCTAssertEqual(persisted.body, replacement.body)
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
        let task = OfflineTask(id: UUID().uuidString, title: "Original", status: "open", domain_id: "00000000-0000-4000-8000-000000000001", updated_at: "2026-09-24T01:02:03.000Z")
        let snapshot = TaskSnapshot(destination: OfflineStore.destination(for: client), tasks: [task], scopes: [], identity: identity)
        try store.saveSnapshot(snapshot)
        return snapshot
    }

    private func response<T: Encodable>(_ body: T, _ request: URLRequest) throws -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, try JSONEncoder().encode(body))
    }

    private func rawResponse(_ request: URLRequest, _ text: String, status: Int = 200) -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, Data(text.utf8))
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

extension OfflineTests {
    func testSavingWithNoChangesQueuesNothingAndRevertingWithdrawsTheEdit() throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        try model.saveEdit(snapshot.tasks[0])
        XCTAssertTrue(model.edits.isEmpty, "an unchanged save must not queue an operation")
        var changed = snapshot.tasks[0]
        changed.title = "Changed"
        try model.saveEdit(changed)
        XCTAssertEqual(model.edits.count, 1)
        try model.saveEdit(snapshot.tasks[0])
        XCTAssertTrue(model.edits.isEmpty, "reverting to the base withdraws the unsent edit")
    }

    func testCheckboxTogglesDoneThroughTheQueue() throws {
        let snapshot = try seedSnapshot()
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        try model.toggleDone(snapshot.tasks[0])
        XCTAssertEqual(model.visibleTasks.first?.status, "done")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: model.edits[0].body) as? [String: Any])
        XCTAssertEqual(body["status"] as? String, "done")
        try model.toggleDone(snapshot.tasks[0])
        XCTAssertTrue(model.edits.isEmpty, "toggling straight back is a no-op, not a second operation")
    }

    func testCorruptCaptureManifestDoesNotBlockTaskEdits() throws {
        let snapshot = try seedSnapshot()
        let broken = LocalCapture(text: "Damaged")
        try store.save(broken)
        try Data("broken".utf8).write(to: store.directory(broken.id).appendingPathComponent("capture.json"))
        let model = OfflineModel(store: store, monitorNetwork: false)
        model.loadSnapshot(client: client)
        XCTAssertNotNil(model.storageError)
        var changed = snapshot.tasks[0]
        changed.title = "Still editable"
        XCTAssertNoThrow(try model.saveEdit(changed))
    }

    func testStoreMovesFromApplicationSupportIntoTheAppGroupOnce() throws {
        let legacy = root.appendingPathComponent("legacy/Offline", isDirectory: true)
        let shared = root.appendingPathComponent("group/Offline", isDirectory: true)
        let old = try OfflineStore(root: legacy)
        var capture = LocalCapture(text: "From the old location")
        try capture.prepare()
        try old.save(capture)
        let moved = try OfflineStore.applicationStore(legacy: legacy, shared: shared)
        XCTAssertEqual(moved.root.standardizedFileURL, shared.standardizedFileURL)
        XCTAssertEqual(moved.load().captures.first?.text, "From the old location")
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path))
        // A second launch finds the shared store and never touches the old path again.
        let again = try OfflineStore.applicationStore(legacy: legacy, shared: shared)
        XCTAssertEqual(again.load().captures.count, 1)
    }

    func testWorkspaceSnapshotCarriesTheDomainsBoardAndTimezone() async throws {
        OfflineTransport.handler = { request in
            XCTAssertEqual(request.url!.path, "/api/local-workspace")
            let body = """
            {"protocol_version":1,"identity":{"task_edit_protocol":1,"dataSpaceId":"11111111-2222-4333-8444-555555555555","serverEpoch":1},
             "done_window_days":30,"timezone":"Pacific/Auckland",
             "domains":[{"id":"d1","name":"Home","illustration":{"svg":"<circle cx=\\"1\\" cy=\\"1\\" r=\\"1\\"/>"}}],
             "projects":[{"id":"p1","name":"Roof","domain_id":"d1","kind":"target"}],
             "tasks":[{"id":"t1","title":"Fix","status":"open","domain_id":"d1","project_id":"p1","updated_at":"2026-09-24T01:02:03.000Z","priority":2,
                       "waiting_on":null,"recurrence_rule":"weekly","parent_task":{"id":"t0","title":"Parent"}}],
             "scopes":[],
             "work":{"ideasCount":2,"parked":[],"domains":[{"id":"d1","name":"Home","parked":false,"urgency":"over",
               "rollup":{"attention":0,"open":1,"overdue":1,"waiting":0},"assets":[],"content":[],
               "direct":{"open":0,"overdue":0,"waiting":0,"waitingAging":0,"today":0},
               "projects":[{"id":"p1","kind":"target","name":"Roof","asset":null,"client":null,"target":"2026-10-03","cycle":null,"pct":15,
                 "open":1,"overdue":1,"waiting":0,"waitOn":null,"waitDays":null,"recency":"active today","flagged":true,"paused":false,"urgency":"over"}]}]}}
            """
            return self.rawResponse(request, body)
        }
        let snapshot = try await client.offlineSnapshot()
        XCTAssertEqual(snapshot.timezone, "Pacific/Auckland")
        XCTAssertEqual(snapshot.work?.ideasCount, 2)
        XCTAssertEqual(snapshot.work?.domain("d1")?.projects.first?.progress, 15)
        XCTAssertEqual(snapshot.work?.project("p1")?.domain.name, "Home")
        XCTAssertEqual(snapshot.tasks.first?.parent_task?.title, "Parent")
        XCTAssertEqual(snapshot.domain("d1")?.illustration?.svg.contains("circle"), true)
    }

    func testOlderServerIsReportedAsUnsupportedNotAsACaptureFailure() async throws {
        OfflineTransport.handler = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, Data("{\"error\":\"not_found\"}".utf8))
        }
        do { _ = try await client.syncIdentity(); XCTFail("expected unsupportedServer") }
        catch OfflineError.unsupportedServer {}
    }
}
