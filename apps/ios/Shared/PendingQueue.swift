import Foundation

/// Tasks captured by the share extension while the tailnet was unreachable.
/// Stored as JSON in the App Group container; the main app flushes on every
/// foreground. Deliberately not a sync engine: POST each entry, drop it on
/// success — and also on a 400, since a payload the server rejects once will
/// be rejected forever.
enum PendingQueue {
    private static var fileURL: URL {
        AppGroup.containerURL.appendingPathComponent("pending-tasks.json")
    }

    static func load() -> [CreateTaskPayload] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([CreateTaskPayload].self, from: data)) ?? []
    }

    static func append(_ payload: CreateTaskPayload) {
        save(load() + [payload])
    }

    static var count: Int { load().count }

    private static func save(_ payloads: [CreateTaskPayload]) {
        if payloads.isEmpty {
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        guard let data = try? JSONEncoder().encode(payloads) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    static func flushSoon() {
        Task.detached(priority: .utility) { await flush() }
    }

    static func flush() async {
        let queued = load()
        guard !queued.isEmpty, let client = APIClient.forDevice, client.bearer != nil else { return }

        var remaining: [CreateTaskPayload] = []
        for payload in queued {
            do {
                try await client.createTask(payload)
            } catch APIError.http(let status, _) where (400..<500).contains(status) {
                continue // permanently rejected — drop it
            } catch {
                remaining.append(payload) // network trouble — keep for next time
            }
        }
        save(remaining)
    }
}
