import SwiftUI

// The app's chrome, mirroring the web's mobile shell: five positions —
// Agenda · Domains · [✦ Capture] · Search · More. Agenda and every "More"
// destination render the web app inside the in-app shell (same signed-in
// cookie session across launches); Domains, Search and Capture are native and
// work without the server. The shell's WKWebView stays mounted across tab
// switches so it never reloads.

enum ShellTab: Hashable { case agenda, domains, search, web }

enum ShellSheet: String, Identifiable {
    case capture, more, settings, newTask, captures, onboarding
    var id: String { rawValue }
}

struct AppShell: View {
    @EnvironmentObject private var config: AppConfig
    @EnvironmentObject private var router: AppRouter
    @StateObject private var model: OfflineModel
    @StateObject private var agenda: AgendaModel
    @StateObject private var shell = ShellState()
    @State private var tab: ShellTab = .agenda
    @State private var sheet: ShellSheet?
    @State private var captureMode: CaptureMode = .menu
    @State private var composeContext: ComposeContext?
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG
        if OfflineFixture.isActive {
            let fixture = OfflineModel(store: try! OfflineFixture.store(), monitorNetwork: false)
            fixture.useOfflineFixture(client: OfflineFixture.client)
            _model = StateObject(wrappedValue: fixture)
            _agenda = StateObject(wrappedValue: AgendaModel(offline: fixture, fixture: OfflineFixture.agendaBundle()))
            _tab = State(initialValue: Self.launchTab)
            return
        }
        let offline = OfflineModel()
        _model = StateObject(wrappedValue: offline)
        _agenda = StateObject(wrappedValue: AgendaModel(offline: offline))
        _tab = State(initialValue: Self.launchTab)
        #else
        let offline = OfflineModel()
        _model = StateObject(wrappedValue: offline)
        _agenda = StateObject(wrappedValue: AgendaModel(offline: offline))
        #endif
    }

    #if DEBUG
    /// `-offline-ui-tab domains|search` opens a tab directly (screenshots, dev).
    private static var launchTab: ShellTab {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-offline-ui-tab"), index + 1 < args.count else { return .agenda }
        return args[index + 1] == "domains" ? .domains : args[index + 1] == "search" ? .search : .agenda
    }
    #endif

    private var fixtureActive: Bool {
        #if DEBUG
        return OfflineFixture.isActive
        #else
        return false
        #endif
    }

    /// The tab bar's "More" highlights while a web destination is showing,
    /// exactly as the web bar does for its non-tab routes.
    private var moreActive: Bool { tab == .web }

    private var colorScheme: ColorScheme? {
        switch config.theme { case "light": return .light; case "dark": return .dark; default: return nil }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Theme.bg.ignoresSafeArea()
            // The web shell runs full-bleed — the page pads its own bottom for
            // a bar of this height, exactly as it does under the web's bar.
            WebTabView(shell: shell, onSettings: { sheet = .settings }, onAgenda: { select(.agenda) })
                .opacity(tab == .web ? 1 : 0)
                .allowsHitTesting(tab == .web)
                .accessibilityHidden(tab != .web)
            // Native tabs treat the bar as a bottom safe-area inset so their
            // scroll views end at its top edge.
            Group {
                if tab == .agenda {
                    AgendaView(model: agenda, offline: model, onWeb: openWeb, onSettings: { sheet = .settings })
                }
                if tab == .domains {
                    DomainsView(model: model, onCompose: { composeContext = $0 }, onWeb: openWeb)
                }
                if tab == .search {
                    SearchView(model: model, onWeb: openWeb)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: TabBar.height) }

            VStack(spacing: 0) {
                if model.recordingID != nil, sheet == nil { ListeningBubble(model: model) }
                TabBar(active: tab, moreActive: moreActive, recording: model.recordingID != nil,
                       onTab: select, onCapture: { captureTapped() }, onRecord: { captureLongPressed() }, onMore: { sheet = .more })
            }
            .ignoresSafeArea(.keyboard, edges: .bottom)
        }
        .preferredColorScheme(colorScheme)
        .tint(Theme.accent)
        .sheet(item: $sheet, content: sheetContent)
        .sheet(item: $composeContext) { context in
            TaskComposeView(initialTitle: "", sharedURL: nil, preset: context) { _ in composeContext = nil }
        }
        .fullScreenCover(isPresented: Binding(get: { !config.onboarded && !fixtureActive }, set: { _ in })) {
            OnboardingView()
        }
        .onChange(of: router.pendingRoute) { _, _ in consumeRoute() }
        .onAppear {
            shell.nativeRoute = { path in
                if path == "/" || path == "/today" { select(.agenda); return true }
                if path == "/work" || path.hasPrefix("/work/") { select(.domains); return true }
                if path == "/search" { select(.search); return true }
                return false
            }
            consumeRoute()
        }
        .onChange(of: config.apiBaseURL) { _, _ in model.loadSnapshot() }
        // The shell may have been created before a server address existed
        // (first run) or with a stale one; both finish with a fresh load.
        .onChange(of: config.webBaseURL) { _, _ in shell.offlineMessage = nil; shell.reloadFromOrigin() }
        .onChange(of: config.onboarded) { _, done in
            if done { shell.offlineMessage = nil; shell.reloadFromOrigin() }
            Task { await model.refresh() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh(); await agenda.refresh() }; PendingQueue.flushSoon() }
            if phase == .background { model.stopRecording() }
        }
        .task {
            model.loadSnapshot()
            #if DEBUG
            if OfflineFixture.isActive { return }
            #endif
            await ReferenceCache.refresh()
            PendingQueue.flushSoon()
            while !Task.isCancelled {
                await model.foregroundTick()
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
            }
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: ShellSheet) -> some View {
        switch sheet {
        case .capture:
            CaptureSheet(model: model, mode: captureMode, onOpenWeb: { path in self.sheet = nil; openWeb(path) },
                         onNewTask: { self.sheet = nil; composeContext = ComposeContext() })
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
        case .more:
            MoreSheet(currentPath: tab == .web ? shell.currentPath : "/", flags: agenda.bundle?.settings,
                      badges: (agenda.bundle?.attention.active_count ?? 0, agenda.bundle?.masthead.unread ?? 0),
                      onOpen: { path in self.sheet = nil; openWeb(path) },
                      onCaptures: { self.sheet = .captures }, onSettings: { self.sheet = .settings })
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.hidden)
        case .settings:
            SettingsView(onReload: { shell.reloadFromOrigin(); Task { await model.refresh(); await agenda.refresh(force: true) } },
                         onTheme: { shell.applyTheme($0) },
                         onWeb: { path in openWeb(path) })
        case .newTask:
            TaskComposeView(initialTitle: "", sharedURL: nil, preset: ComposeContext()) { _ in self.sheet = nil }
        case .captures:
            NavigationStack { CaptureLibraryView(model: model) }
        case .onboarding:
            OnboardingView()
        }
    }

    private func select(_ next: ShellTab) {
        if next == .agenda, tab == .agenda { Task { await agenda.refresh() } }
        tab = next
    }

    /// Opens a web path inside the shell and shows it (the web's More items,
    /// the capture grid's create routes, "Open on web" links).
    private func openWeb(_ path: String) {
        if path == "/" || path == "/today" { select(.agenda); return }
        shell.load(path: path)
        tab = .web
    }

    private func captureTapped() {
        if model.recordingID != nil { model.stopRecording(); return }
        captureMode = .menu
        sheet = .capture
    }

    private func captureLongPressed() {
        guard model.recordingID == nil else { return }
        Task {
            do { try await model.startRecording(note: "") }
            catch { captureMode = .menu; sheet = .capture }
        }
    }

    private func consumeRoute() {
        guard let route = router.pendingRoute else { return }
        router.pendingRoute = nil
        switch route {
        case .newTask: composeContext = ComposeContext()
        case .settings: sheet = .settings
        case .openPath(let path):
            if shell.nativeRoute?(path) != true { openWeb(path) }
        }
    }
}

