import SwiftUI
import WebKit

/// No credentials or arbitrary HTTP bridge is exposed to JavaScript. Only the
/// bundled main frame can issue the small set of local workspace commands.
struct LocalWorkspaceView: UIViewRepresentable {
    @ObservedObject var model: OfflineModel
    var onAction: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(model: model, onAction: onAction) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "workspace")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        context.coordinator.webView = view
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "LocalWorkspace") {
            context.coordinator.bundleRoot = url.deletingLastPathComponent()
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.onAction = onAction; context.coordinator.publish() }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "workspace", contentWorld: .page)
    }

    @MainActor final class Coordinator: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
        let model: OfflineModel
        var onAction: (String) -> Void
        weak var webView: WKWebView?
        var bundleRoot: URL?
        init(model: OfflineModel, onAction: @escaping (String) -> Void) { self.model = model; self.onAction = onAction }
        func trusted(_ url: URL?) -> Bool {
            guard let url, let bundleRoot, url.isFileURL else { return false }
            return url.standardizedFileURL.path.hasPrefix(bundleRoot.standardizedFileURL.path + "/")
        }
        func state() throws -> [String: Any] {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            var result: [String: Any] = ["snapshot": NSNull(), "edits": [], "loaded": true, "syncing": model.syncing || model.refreshing]
            if let snapshot = model.snapshot {
                var json = try JSONSerialization.jsonObject(with: encoder.encode(snapshot)) as! [String: Any]
                json["domains"] = try JSONSerialization.jsonObject(with: encoder.encode(snapshot.domains ?? []))
                json["projects"] = try JSONSerialization.jsonObject(with: encoder.encode(snapshot.projects ?? []))
                result["snapshot"] = json
                result["edits"] = try JSONSerialization.jsonObject(with: encoder.encode(model.edits.filter { $0.destination == snapshot.destination }))
                if snapshot.domains == nil { result["message"] = "Connect and sync to download the domain structure. Your saved tasks and pending edits are preserved." }
            }
            if let message = model.connectionMessage { result["message"] = message }
            if let error = model.storageError { result["error"] = error }
            return result
        }
        func publish() {
            guard let value = try? state() else { return }
            Task { try? await webView?.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('workspace-state', {detail: state}));", arguments: ["state": value], in: nil, contentWorld: .page) }
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
            guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url),
                  let body = message.body as? [String: Any], let action = body["action"] as? String else {
                replyHandler(nil, "Untrusted workspace request."); return
            }
            Task { @MainActor in
                do {
                    switch action {
                    case "load": model.loadSnapshot()
                    case "sync": await model.refresh()
                    case "save":
                        guard let payload = body["payload"] as? [String: Any] else { throw OfflineError.invalidStoredCapture }
                        let data = try JSONSerialization.data(withJSONObject: payload["task"] ?? NSNull())
                        let task = try JSONDecoder().decode(OfflineTask.self, from: data)
                        try model.saveEdit(task, expectedRevision: payload["revision"] as? String, checkRevision: true)
                    case "resolve", "review":
                        guard let payload = body["payload"] as? [String: String], let id = payload["id"],
                              let edit = model.edits.first(where: { $0.id.uuidString.lowercased() == id.lowercased() && $0.destination == model.snapshot?.destination }) else { throw OfflineError.invalidStoredCapture }
                        if action == "review" { try await model.reviewServerVersion(edit) }
                        else if payload["choice"] == "server" { try model.useServer(edit) }
                        else if payload["choice"] == "local" { try model.reapplyEdit(edit) }
                        else { throw OfflineError.invalidStoredCapture }
                    case "action":
                        guard let name = body["payload"] as? String, (["agenda", "capture", "captures", "settings", "online"].contains(name) || name.range(of: "^details:/maintenance/[0-9a-fA-F-]{36}$", options: .regularExpression) != nil) else { throw OfflineError.invalidStoredCapture }
                        onAction(name)
                    default: throw OfflineError.invalidStoredCapture
                    }
                    replyHandler(try state(), nil)
                } catch { replyHandler(nil, error.localizedDescription) }
            }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { publish() }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(trusted(navigationAction.request.url) ? .allow : .cancel)
        }
    }
}
