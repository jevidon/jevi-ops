import WebKit
import XCTest

@MainActor
final class ShellStateTests: XCTestCase {
    func testReloadLoadsCorrectedWebURLInsteadOfCurrentAPILandingPage() {
        let webView = RecordingWebView()
        webView.currentURL = URL(string: "https://server.example.invalid:8443")!
        let shell = ShellState()
        shell.webView = webView
        let home = URL(string: "https://server.example.invalid")!

        shell.reloadFromOrigin(home: home)

        XCTAssertEqual(webView.loadedRequest?.url, home)
        XCTAssertFalse(webView.reloadedCurrentPage)
    }

    func testRetryLoadsConfiguredWebURLWhenNoPageHasLoaded() {
        let webView = RecordingWebView()
        let shell = ShellState()
        shell.webView = webView
        let home = URL(string: "https://web.example.invalid")!

        shell.reloadFromOrigin(home: home)

        XCTAssertEqual(webView.loadedRequest?.url, home)
        XCTAssertFalse(webView.reloadedCurrentPage)
    }
}

/// Records navigation without loading a URL or using persistent web data.
@MainActor
private final class RecordingWebView: WKWebView {
    var currentURL: URL?
    var loadedRequest: URLRequest?
    var reloadedCurrentPage = false

    init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        super.init(frame: .zero, configuration: configuration)
    }

    required init?(coder: NSCoder) { fatalError("Not used by tests") }

    override var url: URL? { currentURL }

    override func load(_ request: URLRequest) -> WKNavigation? {
        loadedRequest = request
        return nil
    }

    override func reload() -> WKNavigation? {
        reloadedCurrentPage = true
        return nil
    }
}
