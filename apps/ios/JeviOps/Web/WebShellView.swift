import SwiftUI
import WebKit

/// Observable bridge between SwiftUI and the WKWebView living inside the
/// UIKit shell controller.
final class ShellState: ObservableObject {
    @Published var offlineMessage: String?
    weak var webView: WKWebView?

    func reloadFromOrigin() {
        guard let webView else { return }
        if webView.url == nil, let home = AppConfig.shared.webURL {
            webView.load(URLRequest(url: home))
        } else {
            webView.reload()
        }
    }

    func load(path: String) {
        guard let base = AppConfig.shared.webURL,
              let url = URL(string: path, relativeTo: base),
              let webView
        else { return }
        webView.load(URLRequest(url: url))
    }
}

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
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
        state.offlineMessage = nil
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
