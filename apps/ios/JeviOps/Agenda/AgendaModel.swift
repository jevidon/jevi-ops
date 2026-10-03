import Foundation
import Combine

/// The native Agenda's data: one bundle per refresh, cached per destination
/// so the last briefing renders offline. Inline actions mirror the web's
/// server actions — best-effort API calls followed by a reload — except task
/// completion, which goes through the offline queue when the task is in the
/// synced snapshot so it survives a dropped connection.
@MainActor
final class AgendaModel: ObservableObject {
    @Published private(set) var bundle: AgendaBundle?
    @Published private(set) var loading = false
    @Published private(set) var message: String?
    @Published private(set) var skipped: [String] = []

    private let offline: OfflineModel
    private var fixture: AgendaBundle?
    private let defaults = UserDefaults.standard

    init(offline: OfflineModel, fixture: AgendaBundle? = nil) {
        self.offline = offline
        self.fixture = fixture
        skipped = defaults.stringArray(forKey: "agenda.resurfacing.skipped.\(DueLabel.today(in: nil))") ?? []
        if let fixture { bundle = fixture; return }
        loadCached()
    }

    private var client: APIClient? { APIClient.forDevice.flatMap { $0.bearer == nil ? nil : $0 } }
    private var cacheURL: URL? {
        guard let client, let store = offline.store else { return nil }
        return store.root.appendingPathComponent("agenda-\(OfflineStore.destination(for: client)).json")
    }

    var isStale: Bool { bundle?.fetchedAt.map { Date().timeIntervalSince($0) > 3600 } ?? true }

    func loadCached() {
        guard let url = cacheURL, let data = try? Data(contentsOf: url),
              let cached = try? JSONDecoder().decode(AgendaBundle.self, from: data) else { return }
        bundle = cached
    }

    func refresh(force: Bool = false) async {
        if fixture != nil { return }
        guard let client else { message = offline.isLinked ? nil : OfflineError.notLinked.localizedDescription; return }
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let skip = skipped.joined(separator: ",").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
            var fresh: AgendaBundle
            do { fresh = try await client.send("GET", "/api/briefing/bundle?skip=\(skip)", timeout: 30) }
            catch APIError.http(404, _) { throw OfflineError.unsupportedServer }
            catch APIError.webPageResponse { throw OfflineError.unsupportedServer }
            fresh.fetchedAt = Date()
            bundle = fresh
            message = nil
            if let url = cacheURL { try? JSONEncoder().encode(fresh).write(to: url, options: .atomic) }
        } catch {
            message = bundle == nil ? error.localizedDescription : "Showing the last briefing. \(error.localizedDescription)"
        }
    }

    // MARK: - Inline actions (each reloads the bundle afterwards)

    private func act(_ work: @escaping (APIClient) async throws -> Void) {
        guard let client else { message = OfflineError.notLinked.localizedDescription; return }
        Task {
            do { try await work(client) } catch { message = error.localizedDescription }
            await refresh()
        }
    }

    private func json(_ object: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: object) }

    func toggleDone(_ task: OfflineTask) {
        if offline.snapshot?.tasks.contains(where: { $0.id == task.id }) == true {
            do { try offline.toggleDone(task) } catch { message = error.localizedDescription }
            Task { await refresh() }
            return
        }
        act { client in
            _ = try await client.sendRaw("PATCH", "/api/tasks/\(task.id)", bodyData: try self.json(["status": task.isDone ? "open" : "done"]))
        }
    }

    func completeAgendaTask(_ id: String) {
        act { client in _ = try await client.sendRaw("PATCH", "/api/tasks/\(id)", bodyData: try self.json(["status": "done"])) }
    }

    func toggleTop3(_ task: OfflineTask) {
        let today = bundle?.today ?? DueLabel.today(in: bundle?.tz)
        act { client in
            _ = try await client.sendRaw("PATCH", "/api/tasks/\(task.id)",
                                         bodyData: try self.json(["top3_for_date": task.top3_for_date == today ? NSNull() : today]))
        }
    }

    func logCheckIn(companyID: String) {
        act { client in
            _ = try await client.sendRaw("POST", "/api/conversations", bodyData: try self.json([
                "company_id": companyID, "interaction_type": "other", "direction": "outbound",
                "summary": "Checked in", "occurred_at": ISO8601DateFormatter().string(from: Date()),
            ]))
        }
    }

    func attention(_ id: String, action: String) {
        act { client in _ = try await client.sendRaw("PATCH", "/api/attention/\(id)", bodyData: try self.json(["action": action])) }
    }

    func toggleRoutine(_ routine: AgendaBundle.Routine) {
        act { client in
            _ = try await client.sendRaw("POST", "/api/routines/\(routine.id)/completions", bodyData: try self.json(["done": !routine.stats.done_today]))
        }
    }

    func unpin(_ pin: AgendaBundle.Pin) {
        act { client in
            _ = try await client.sendRaw("DELETE", "/api/pins?target_type=\(pin.target_type)&target_id=\(pin.target_id)", bodyData: nil)
        }
    }

    func movePin(_ pin: AgendaBundle.Pin, up: Bool) {
        guard var ids = bundle?.pins.map(\.id), let index = ids.firstIndex(of: pin.id) else { return }
        let target = up ? index - 1 : index + 1
        guard ids.indices.contains(target) else { return }
        ids.swapAt(index, target)
        act { client in _ = try await client.sendRaw("PATCH", "/api/pins/reorder", bodyData: try self.json(["ids": ids])) }
    }

    /// Resurfacing "Next" and "Reset" are per-device state, as the web keeps
    /// them per browser in a cookie.
    func skipResurfacing(_ id: String) {
        skipped.append(id)
        defaults.set(skipped, forKey: "agenda.resurfacing.skipped.\(DueLabel.today(in: bundle?.tz))")
        Task { await refresh() }
    }

    func resetResurfacing() {
        skipped = []
        defaults.removeObject(forKey: "agenda.resurfacing.skipped.\(DueLabel.today(in: bundle?.tz))")
        Task { await refresh() }
    }
}
