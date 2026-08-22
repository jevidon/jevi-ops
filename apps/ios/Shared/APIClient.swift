import Foundation

enum APIError: LocalizedError {
    case badURL
    case http(status: Int, body: String)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .badURL:
            return "Server URL is not valid."
        case .http(let status, let body):
            switch status {
            case 401: return "Not authorized — the device token may have been revoked."
            case 429: return "Too many attempts — wait a minute and retry."
            default: return "Server error \(status): \(body.prefix(200))"
            }
        case .network:
            return "Can't reach the server — is Tailscale connected?"
        }
    }
}

/// Thin URLSession client for the Fastify API. Authenticated calls send the
/// long-lived `ops_` device token; login/mint are the one-time onboarding
/// exchange (JWT held in memory only, never stored).
struct APIClient {
    let baseURL: URL
    var bearer: String?

    static var forDevice: APIClient? {
        guard let url = AppConfig.shared.apiURL else { return nil }
        return APIClient(baseURL: url, bearer: KeychainStore.deviceToken)
    }

    // MARK: - Endpoints

    /// Unauthenticated liveness probe with a short timeout — used to tell
    /// "tailnet down" apart from "server down" without hanging the UI.
    func healthz(timeout: TimeInterval = 3) async -> Bool {
        guard let url = URL(string: "/healthz", relativeTo: baseURL) else { return false }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "GET"
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse
        else { return false }
        return http.statusCode == 200
    }

    func login(email: String, password: String) async throws -> String {
        let response: LoginResponse = try await send(
            "POST", "/api/auth/login",
            body: ["email": email, "password": password]
        )
        return response.token
    }

    func mintDeviceToken(named name: String) async throws -> String {
        let response: MintTokenResponse = try await send(
            "POST", "/api/auth/tokens",
            body: ["name": name, "kind": "device"]
        )
        return response.token
    }

    func fetchDomains() async throws -> [Domain] {
        let response: DomainsResponse = try await send("GET", "/api/domains")
        return response.domains.filter(\.isPickable)
    }

    func fetchProjects() async throws -> [Project] {
        let response: ProjectsResponse = try await send("GET", "/api/projects")
        return response.projects.filter(\.isPickable).sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    func createTask(_ payload: CreateTaskPayload) async throws {
        let data = try JSONEncoder().encode(payload)
        _ = try await sendRaw("POST", "/api/tasks", bodyData: data)
    }

    // MARK: - Transport

    private func send<T: Decodable>(
        _ method: String, _ path: String, body: [String: String]? = nil
    ) async throws -> T {
        let bodyData = body.map { try! JSONSerialization.data(withJSONObject: $0) }
        let data = try await sendRaw(method, path, bodyData: bodyData)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func sendRaw(_ method: String, _ path: String, bodyData: Data?) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.badURL }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = method
        if let bearer {
            request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        if let bodyData {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = bodyData
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError.network(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.network(URLError(.badServerResponse))
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(
                status: http.statusCode,
                body: String(data: data, encoding: .utf8) ?? ""
            )
        }
        return data
    }
}
