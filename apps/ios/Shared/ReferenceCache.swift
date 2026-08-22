import Foundation

/// Domains + projects cached as JSON in the App Group container so the
/// share extension's pickers open instantly (and work offline). The main
/// app refreshes on foreground; onboarding seeds it.
enum ReferenceCache {
    struct Payload: Codable {
        var domains: [Domain]
        var projects: [Project]
        var fetchedAt: Date
    }

    private static var fileURL: URL {
        AppGroup.containerURL.appendingPathComponent("reference.json")
    }

    static func load() -> Payload? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(Payload.self, from: data)
    }

    static func save(domains: [Domain], projects: [Project]) {
        let payload = Payload(domains: domains, projects: projects, fetchedAt: Date())
        guard let data = try? JSONEncoder().encode(payload) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Fetch fresh lists and persist them. Offline errors are swallowed —
    /// the cache keeps its last-known-good contents — but decode/HTTP
    /// failures are logged so they don't hide.
    static func refresh() async {
        guard let client = APIClient.forDevice, client.bearer != nil else {
            print("[jeviops] refresh skipped: no api url or device token")
            return
        }
        do {
            let domains = try await client.fetchDomains()
            let projects = try await client.fetchProjects()
            save(domains: domains, projects: projects)
            print("[jeviops] refresh ok: \(domains.count) domains, \(projects.count) projects → \(fileURL.path)")
        } catch {
            print("[jeviops] refresh failed: \(error)")
        }
    }
}
