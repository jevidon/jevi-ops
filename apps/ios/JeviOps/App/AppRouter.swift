import Foundation
import Combine

/// Single funnel for everything that can steer the app from outside:
/// home-screen quick actions, the jeviops:// URL scheme, and (later)
/// notifications. RootView observes and consumes pendingRoute.
final class AppRouter: ObservableObject {
    static let shared = AppRouter()

    enum Route: Equatable {
        case newTask
        case settings
        case openPath(String)
    }

    @Published var pendingRoute: Route?

    /// Maps both quick-action types (com.jevidon.jeviops.<name>) and
    /// jeviops:// URLs onto routes.
    func route(forShortcutType type: String) -> Route? {
        switch type.split(separator: ".").last.map(String.init) {
        case "new-task": return .newTask
        case "today": return .openPath("/today")
        case "work": return .openPath("/work")
        case "ask": return .openPath("/chat")
        default: return nil
        }
    }

    func route(for url: URL) -> Route? {
        guard url.scheme == "jeviops" else { return nil }
        switch url.host ?? url.pathComponents.first(where: { $0 != "/" }) ?? "" {
        case "new-task":
            return .newTask
        case "settings":
            return .settings
        case "open":
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let path = components?.queryItems?.first(where: { $0.name == "path" })?.value ?? "/today"
            return .openPath(path)
        default:
            return nil
        }
    }
}
