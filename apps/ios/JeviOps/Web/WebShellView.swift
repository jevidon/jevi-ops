import SwiftUI
import WebKit

/// Observable bridge between SwiftUI and the WKWebView living inside the
/// UIKit shell controller.
final class ShellState: ObservableObject {
    @Published var offlineMessage: String?
    /// The path the shell is showing, so the native tab bar can highlight
    /// Agenda (`/`, `/inbox…`) versus More (everything else) exactly as the
    /// web's BottomTabBar does.
    @Published var currentPath: String = "/"
    @Published var loading = false
    weak var webView: WKWebView?
    /// Paths the native app owns. Returning true swallows the navigation so
    /// a link to /work inside a web page lands on the native Domains tab.
    var nativeRoute: ((String) -> Bool)?

    /// Home also covers the sign-in page the web redirects to before a
    /// session exists — that is still the Agenda doorway, not a More route.
    var isHome: Bool {
        currentPath == "/" || currentPath == "/inbox" || currentPath.hasPrefix("/inbox/") || currentPath.hasPrefix("/sign-in")
    }

    func reloadFromOrigin(home: URL? = AppConfig.shared.webURL) {
        guard let webView, let home else { return }
        // Settings may have corrected the Web URL while an old page (even
        // the API landing page) is still loaded. Re-read the configured URL
        // instead of reloading that stale destination.
        webView.load(URLRequest(url: home))
    }

    func load(path: String) {
        guard let base = AppConfig.shared.webURL,
              let url = URL(string: path, relativeTo: base),
              let webView
        else { return }
        webView.load(URLRequest(url: url))
    }

    func goBack() { webView?.goBack() }

    /// Mirrors the native appearance choice into the web's `jops2.theme`
    /// cookie (the root layout stamps <html data-theme> from it), then
    /// reloads so the page repaints in the same theme as the chrome around it.
    func applyTheme(_ theme: String, reload: Bool = true) {
        guard let host = AppConfig.shared.webURL?.host else { return }
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: "jops2.theme", .value: theme, .domain: host, .path: "/",
            .expires: Date().addingTimeInterval(365 * 86_400),
        ]
        if AppConfig.shared.webURL?.scheme == "https" { properties[.secure] = "TRUE" }
        guard let cookie = HTTPCookie(properties: properties) else { return }
        WKWebsiteDataStore.default().httpCookieStore.setCookie(cookie) { [weak self] in
            if reload { DispatchQueue.main.async { self?.webView?.reload() } }
        }
    }
}

/// Injected at document start: the web's own mobile tab bar and its capture
/// star are replaced by the native chrome, so they are hidden inside the
/// shell. Everything else on the page — including its bottom padding, which
/// already clears a bar of the same height — stays as the web renders it.
let shellUserScript = """
(function(){var s=document.createElement('style');s.textContent='nav[aria-label="Primary"]{display:none!important}';document.documentElement.appendChild(s);})();
"""

struct WebShellView: UIViewControllerRepresentable {
    let state: ShellState
    var onShake: () -> Void

    func makeUIViewController(context: Context) -> ShellViewController {
        ShellViewController(state: state, onShake: onShake)
    }

    func updateUIViewController(_ controller: ShellViewController, context: Context) {
        controller.onShake = onShake
    }
}

final class ShellViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let state: ShellState
    var onShake: () -> Void

    private var webView: WKWebView!
    private let refreshControl = UIRefreshControl()

    init(state: ShellState, onShake: @escaping () -> Void) {
        self.state = state
        self.onShake = onShake
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()

        let configuration = WKWebViewConfiguration()
        // Default (persistent) data store keeps the HttpOnly ops_session
        // cookie across launches — sign in once at /sign-in and stay in.
        configuration.websiteDataStore = .default()
        // MicFAB voice capture + inline media inside the web app.
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.addUserScript(
            WKUserScript(source: shellUserScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        // The web app handles safe areas itself (viewport-fit=cover), so the
        // webview runs full-bleed with no automatic insets.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.refreshControl = refreshControl
        refreshControl.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        view.addSubview(webView)

        state.webView = webView
        state.applyTheme(AppConfig.shared.theme, reload: false)
        loadHome()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    // Shake anywhere in the shell opens Settings — a personal-app-grade
    // escape hatch since the web UI has no native chrome around it.
    override var canBecomeFirstResponder: Bool { true }
    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake { onShake() }
    }

    private func loadHome() {
        guard let home = AppConfig.shared.webURL else {
            state.offlineMessage = "No server URL configured."
            return
        }
        webView.load(URLRequest(url: home))
    }

    @objc private func pullToRefresh() {
        webView.reload()
    }

    private func isInternal(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        let internalHosts = [
            AppConfig.shared.webURL?.host?.lowercased(),
            AppConfig.shared.apiURL?.host?.lowercased(),
        ].compactMap { $0 }
        return internalHosts.contains(host)
    }

    // MARK: - WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        // mailto:, tel:, etc. go to the system.
        if scheme != "http" && scheme != "https" && scheme != "about" {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        // Main-frame navigations to foreign hosts open in Safari.
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if isMainFrame, (scheme == "http" || scheme == "https"), !isInternal(url) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        // Link taps (not programmatic loads) to natively owned paths switch
        // tabs instead of rendering the web version inside the shell.
        if isMainFrame, navigationAction.navigationType == .linkActivated, isInternal(url),
           state.nativeRoute?(url.path.isEmpty ? "/" : url.path) == true {
            decisionHandler(.cancel)
            return
        }
        if isMainFrame, isInternal(url) {
            state.currentPath = url.path.isEmpty ? "/" : url.path
            state.loading = true
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
        state.offlineMessage = nil
        state.loading = false
        if let url = webView.url, isInternal(url) { state.currentPath = url.path.isEmpty ? "/" : url.path }
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        handleFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    private func handleFailure(_ error: Error) {
        refreshControl.endRefreshing()
        let nsError = error as NSError
        // -999 is a cancelled load (normal during rapid navigation).
        guard nsError.code != NSURLErrorCancelled else { return }
        state.loading = false
        state.offlineMessage = "Can't reach the server — is Tailscale connected?"
    }

    // MARK: - WKUIDelegate

    // target=_blank links: same host loads in place, others go to Safari.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isInternal(url) {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    // Skip WebKit's per-origin mic/camera prompt — the OS-level permission
    // prompt (usage strings) still applies.
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }
}
