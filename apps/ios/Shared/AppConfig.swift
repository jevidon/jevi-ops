import Foundation
import Combine

/// Configuration shared between the app and the share extension via the
/// App Group. On simulator builds without entitlements the suite still
/// resolves (the simulator doesn't enforce app groups), so there is one
/// code path.
enum AppGroup {
    static let id = "group.com.jevidon.jeviops"

    static var defaults: UserDefaults {
        UserDefaults(suiteName: id) ?? .standard
    }

    /// Shared container for the reference cache and pending queue. Falls
    /// back to Caches when the container is unavailable (never expected on
    /// device once entitlements are set up).
    static var containerURL: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id)
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }
}

final class AppConfig: ObservableObject {
    static let shared = AppConfig()

    private let defaults = AppGroup.defaults

    @Published var webBaseURL: String {
        didSet { defaults.set(webBaseURL, forKey: "webBaseURL") }
    }
    @Published var apiBaseURL: String {
        didSet { defaults.set(apiBaseURL, forKey: "apiBaseURL") }
    }
    @Published var onboarded: Bool {
        didSet { defaults.set(onboarded, forKey: "onboarded") }
    }

    private init() {
        webBaseURL = defaults.string(forKey: "webBaseURL") ?? ""
        apiBaseURL = defaults.string(forKey: "apiBaseURL") ?? ""
        onboarded = defaults.bool(forKey: "onboarded")
    }

    /// Production convention: web at https://host, API at https://host:8443
    /// (tailscale serve). Localhost dev convention: web :3000, API :3001.
    static func deriveApiURL(fromWebURL web: String) -> String {
        guard var components = URLComponents(string: web), components.host != nil else { return "" }
        if components.host == "localhost" || components.host == "127.0.0.1" {
            components.port = 3001
        } else {
            components.port = 8443
        }
        components.path = ""
        return components.string ?? ""
    }

    var webURL: URL? { URL(string: webBaseURL) }
    var apiURL: URL? { URL(string: apiBaseURL) }
}
