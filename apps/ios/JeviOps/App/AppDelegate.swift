import UIKit

/// Exists solely to install SceneDelegate so home-screen quick actions
/// reach the SwiftUI world (SwiftUI has no native shortcut-item API).
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    // Cold launch from a quick action.
    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        if let item = connectionOptions.shortcutItem,
           let route = AppRouter.shared.route(forShortcutType: item.type) {
            AppRouter.shared.pendingRoute = route
        }
    }

    // Warm launch from a quick action.
    func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        if let route = AppRouter.shared.route(forShortcutType: shortcutItem.type) {
            AppRouter.shared.pendingRoute = route
            completionHandler(true)
        } else {
            completionHandler(false)
        }
    }
}
