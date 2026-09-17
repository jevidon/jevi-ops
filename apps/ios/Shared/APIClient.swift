import Foundation

enum APIError: LocalizedError {
    case badURL
    case invalidCredentials
    case sessionExpired
    case healthAccessDenied
    case http(status: Int, body: String)
    case network(Error)
    case unexpectedResponse(path: String)
    case webPageResponse(path: String)

    var errorDescription: String? {
        switch self {
        case .badURL:
            return "Server URL is not valid."
        case .invalidCredentials:
            return "Email or password incorrect for this server. Check both fields and confirm the API URL points to the same server as the web app."
        case .sessionExpired:
            return "Your sign-in session was rejected while linking this device. Sign in again."
        case .healthAccessDenied:
            return "The server rejected the connection check at /healthz. Check the API URL and proxy access settings."
        case .http(let status, let body):
            switch status {
            case 401: return "Not authorized — the device token may have been revoked."
            case 429: return "Too many attempts — wait a minute and retry."
            default: return "Server error \(status): \(body.prefix(200))"
            }
        case .network(let error):
            return "Can't reach the server: \(error.localizedDescription)"
        case .unexpectedResponse(let path):
            return "The response from \(path) doesn't match the API format. Check the API URL and server version."
        case .webPageResponse(let path):
            return "The API returned a web page for \(path). Check that the API URL and reverse proxy point to the API service, not the web app."
        }
    }
}

/// Thin URLSession client for the Fastify API. Authenticated calls send the
/// long-lived `ops_` device token; login/mint are the one-time onboarding
/// exchange (JWT held in memory only, never stored).
struct APIClient {
    let baseURL: URL
    var bearer: String?
    var session: URLSession = .shared

    static var forDevice: APIClient? {
        guard let url = AppConfig.shared.apiURL else { return nil }
        return APIClient(baseURL: url, bearer: KeychainStore.deviceToken)
    }

    // MARK: - Endpoints

    /// Check the API envelope as well as HTTP success: the web app can
    /// redirect /healthz to an HTML sign-in page that also returns 200.
    func checkHealth(timeout: TimeInterval = 10) async throws {
        do {
            let response: HealthResponse = try await send("GET", "/healthz", timeout: timeout)
            guard response.status == "ok" else {
                throw APIError.unexpectedResponse(path: "/healthz")
            }
        } catch APIError.http(401, _) {
            throw APIError.healthAccessDenied
        }
    }

    func login(email: String, password: String) async throws -> String {
        do {
            let response: LoginResponse = try await send(
                "POST", "/api/auth/login",
                body: ["email": email, "password": password]
            )
            return response.token
        } catch APIError.http(401, _) {
            throw APIError.invalidCredentials
        }
    }

    func mintDeviceToken(named name: String) async throws -> String {
        do {
            let response: MintTokenResponse = try await send(
                "POST", "/api/auth/tokens",
                body: ["name": name, "kind": "device"]
            )
            return response.token
        } catch APIError.http(401, _) {
            throw APIError.sessionExpired
        }
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
        _ method: String, _ path: String, body: [String: String]? = nil,
        timeout: TimeInterval = 15
    ) async throws -> T {
        let bodyData = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        let data = try await sendRaw(method, path, bodyData: bodyData, expectsJSON: true, timeout: timeout)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            // Do not display the response body or decoding context: auth
            // responses can contain credentials even when malformed.
            throw APIError.unexpectedResponse(path: path)
        }
    }

    private func sendRaw(
        _ method: String, _ path: String, bodyData: Data?,
        expectsJSON: Bool = false, timeout: TimeInterval = 15
    ) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.badURL }
        var request = URLRequest(url: url, timeoutInterval: timeout)
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
            (data, response) = try await session.data(for: request)
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
        if expectsJSON, http.mimeType?.lowercased() == "text/html" {
            throw APIError.webPageResponse(path: path)
        }
        return data
    }
}
