import SwiftUI

@main
struct JeviOpsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var config = AppConfig.shared
    @StateObject private var router = AppRouter.shared

    init() {
        // UI tests launch with a clean slate. Runs before AppConfig.shared
        // is first touched (StateObject initial values are lazy).
        if ProcessInfo.processInfo.arguments.contains("-uitest-reset") {
            let defaults = AppGroup.defaults
            ["webBaseURL", "apiBaseURL", "onboarded"].forEach(defaults.removeObject(forKey:))
            KeychainStore.deleteDeviceToken()
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(config)
                .environmentObject(router)
                .onOpenURL { url in
                    if let route = router.route(for: url) {
                        router.pendingRoute = route
                    }
                }
        }
    }
}
