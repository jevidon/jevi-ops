import SwiftUI

struct RootView: View {
    @EnvironmentObject private var config: AppConfig

    var body: some View {
        if config.onboarded {
            ShellContainer()
        } else {
            OnboardingView()
        }
    }
}

/// Wraps the web shell with the offline state, the shake-for-settings
/// gesture, and the on-foreground reference-cache refresh.
struct ShellContainer: View {
    @EnvironmentObject private var config: AppConfig
    @EnvironmentObject private var router: AppRouter
    @StateObject private var shell = ShellState()
    @State private var showSettings = false
    @State private var showNewTask = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            WebShellView(state: shell, onShake: { showSettings = true })
                .ignoresSafeArea()

            if let message = shell.offlineMessage {
                OfflineView(
                    message: message,
                    onRetry: { Task { await retry() } },
                    onSettings: { showSettings = true }
                )
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(onReload: { shell.reloadFromOrigin() })
        }
        .sheet(isPresented: $showNewTask) {
            NewTaskSheet()
        }
        // Quick actions / jeviops:// arrive through the router; consume on
        // appear too so a cold-launch shortcut isn't lost.
        .onAppear { consumeRoute(router.pendingRoute) }
        .onChange(of: router.pendingRoute) { _, route in consumeRoute(route) }
        // .task covers cold launch (scenePhase starts .active, so onChange
        // alone would never fire); onChange covers returns from background.
        .task {
            await ReferenceCache.refresh()
            await PendingQueue.flush()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await ReferenceCache.refresh() }
                PendingQueue.flushSoon()
            }
        }
    }

    private func consumeRoute(_ route: AppRouter.Route?) {
        guard let route else { return }
        router.pendingRoute = nil
        switch route {
        case .newTask: showNewTask = true
        case .settings: showSettings = true
        case .openPath(let path): shell.load(path: path)
        }
    }

    private func retry() async {
        // Probe the API's unauthenticated /healthz first so the message can
        // distinguish "tailnet unreachable" from "server down".
        if let api = config.apiURL {
            let alive = await APIClient(baseURL: api).healthz()
            if !alive {
                shell.offlineMessage = "Still unreachable. Check that Tailscale is connected on this device and the server is up."
                return
            }
        }
        shell.offlineMessage = nil
        shell.reloadFromOrigin()
    }
}
