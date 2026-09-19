import Foundation
import XCTest

/// Hostless tests use an ephemeral session with an in-memory transport.
/// They never launch the app, contact a server, or read/write credentials.
final class APIClientTests: XCTestCase {
    private var session: URLSession!
    private var client: APIClient!

    override func setUp() {
        super.setUp()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        session = URLSession(configuration: config)
        client = APIClient(baseURL: URL(string: "https://api.example.invalid:8443")!, session: session)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        StubURLProtocol.handler = nil
        client = nil
        session = nil
        super.tearDown()
    }

    func testLogin401ExplainsCredentialsAndDoesNotSuggestRevocation() async {
        respond(status: 401, body: #"{"error":"invalid_credentials"}"#)
        let error = await failure { try await self.client.login(email: "owner@example.invalid", password: "wrong") }
        guard case APIError.invalidCredentials = error else { return XCTFail("Expected login error, got \(error)") }
        XCTAssertTrue(error.localizedDescription.contains("Email or password incorrect"))
        XCTAssertFalse(error.localizedDescription.contains("revoked"))
    }

    func testTokenMint401ExplainsRejectedSignInSession() async {
        respond(status: 401, body: #"{"error":"invalid_token"}"#)
        let error = await failure { try await self.client.mintDeviceToken(named: "Test phone") }
        guard case APIError.sessionExpired = error else { return XCTFail("Expected session error, got \(error)") }
        XCTAssertFalse(error.localizedDescription.contains("revoked"))
    }

    func testAuthenticatedCall401StillExplainsDeviceToken() async {
        respond(status: 401, body: #"{"error":"invalid_api_token"}"#)
        client.bearer = "ops_test_only"
        let error = await failure { try await self.client.fetchDomains() }
        guard case APIError.http(401, _) = error else { return XCTFail("Expected HTTP 401, got \(error)") }
        XCTAssertTrue(error.localizedDescription.contains("device token"))
    }

    func testLoginRateLimitIsNotReportedAsIncorrectPassword() async {
        respond(status: 429, body: #"{"error":"too_many_attempts"}"#)
        let error = await failure { try await self.client.login(email: "owner@example.invalid", password: "test") }
        guard case APIError.http(429, _) = error else { return XCTFail("Expected rate limit, got \(error)") }
    }

    func testLoginPreservesPasswordCharactersExactly() async throws {
        let password = " \tpaß/word\"\n"
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/auth/login")
            XCTAssertEqual(request.httpMethod, "POST")
            let data = try Self.body(of: request)
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
            XCTAssertEqual(body["password"], password)
            return Self.response(request, status: 200, body: #"{"token":"test-session","user":{"id":"test-user"}}"#)
        }
        let token = try await client.login(email: "owner@example.invalid", password: password)
        XCTAssertEqual(token, "test-session")
    }

    func testTokenMintSendsSessionAndDecodesCurrentServerEnvelope() async throws {
        client.bearer = "test-session"
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/auth/tokens")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-session")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: Self.body(of: request)) as? [String: String])
            XCTAssertEqual(body["name"], "Test phone")
            XCTAssertEqual(body["kind"], "device")
            return Self.response(request, status: 201, body: #"{"id":"test-id","kind":"device","permission_profile":"legacy","scopes":[],"token":"ops_test_only"}"#)
        }
        let token = try await client.mintDeviceToken(named: "Test phone")
        XCTAssertEqual(token, "ops_test_only")
    }

    func testHealthRequiresAPIEnvelope() async throws {
        respond(status: 200, body: #"{"status":"ok","auth_configured":true}"#)
        try await client.checkHealth()
    }

    func testHealthRejectsSuccessfulHTMLSignInPage() async {
        respond(status: 200, body: "<!DOCTYPE html><html>Sign in</html>", type: "text/html; charset=utf-8")
        let error = await failure { try await self.client.checkHealth() }
        guard case APIError.webPageResponse(path: "/healthz") = error else {
            return XCTFail("Expected API routing error, got \(error)")
        }
    }

    func testHealthRejectsOtherJSONService() async {
        respond(status: 200, body: #"{"status":"unavailable"}"#)
        let error = await failure { try await self.client.checkHealth() }
        guard case APIError.unexpectedResponse(path: "/healthz") = error else {
            return XCTFail("Expected health error, got \(error)")
        }
    }

    func testMalformedLoginResponseIdentifiesEndpointWithoutLeakingBody() async {
        respond(status: 200, body: #"{"token":123,"secret":"do-not-display"}"#)
        let error = await failure { try await self.client.login(email: "owner@example.invalid", password: "test") }
        guard case APIError.unexpectedResponse(path: "/api/auth/login") = error else {
            return XCTFail("Expected login response error, got \(error)")
        }
        XCTAssertFalse(error.localizedDescription.contains("do-not-display"))
    }

    func testMalformedTokenResponseIdentifiesLinkingEndpoint() async {
        respond(status: 201, body: "not JSON")
        let error = await failure { try await self.client.mintDeviceToken(named: "Test phone") }
        guard case APIError.unexpectedResponse(path: "/api/auth/tokens") = error else {
            return XCTFail("Expected linking response error, got \(error)")
        }
    }

    func testHealthPreservesHTTPFailure() async {
        respond(status: 502, body: "Bad gateway", type: "text/plain")
        let error = await failure { try await self.client.checkHealth() }
        guard case APIError.http(502, _) = error else { return XCTFail("Expected HTTP 502, got \(error)") }
    }

    func testHealth401DoesNotSuggestRevokingOrRelinkingDevice() async {
        respond(status: 401, body: "Unauthorized", type: "text/plain")
        let error = await failure { try await self.client.checkHealth() }
        guard case APIError.healthAccessDenied = error else {
            return XCTFail("Expected health access error, got \(error)")
        }
        XCTAssertFalse(error.localizedDescription.contains("token"))
    }

    func testCertificateFailureKeepsUnderlyingReason() async {
        let underlying = URLError(.serverCertificateUntrusted)
        StubURLProtocol.handler = { _ in throw underlying }
        let error = await failure { try await self.client.checkHealth() }
        guard case APIError.network(let cause) = error else { return XCTFail("Expected transport error, got \(error)") }
        XCTAssertEqual((cause as? URLError)?.code, .serverCertificateUntrusted)
        XCTAssertTrue(error.localizedDescription.contains(underlying.localizedDescription))
    }

    private func respond(status: Int, body: String, type: String = "application/json") {
        StubURLProtocol.handler = { Self.response($0, status: status, body: body, type: type) }
    }

    private static func response(
        _ request: URLRequest, status: Int, body: String, type: String = "application/json"
    ) -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                         headerFields: ["Content-Type": type])!, Data(body.utf8))
    }

    private func failure<T>(_ operation: () async throws -> T) async -> Error {
        do {
            _ = try await operation()
            XCTFail("Expected request to fail")
            return URLError(.unknown)
        } catch { return error }
    }

    private static func body(of request: URLRequest) throws -> Data {
        if let data = request.httpBody { return data }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count == 0 { return data }
            if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeRawData) }
            data.append(contentsOf: buffer.prefix(count))
        }
    }
}

private final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw URLError(.resourceUnavailable) }
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
