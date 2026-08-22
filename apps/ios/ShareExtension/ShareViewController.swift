import UIKit
import SwiftUI
import UniformTypeIdentifiers

/// Share-sheet entry point. Extracts the shared URL and/or text, then hosts
/// the shared TaskComposeView. Sharing apps vary: Safari sends a URL plus
/// (usually) the page title as the item's attributedContentText; text
/// selections arrive as plain text with no URL.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        extractSharedContent { [weak self] title, url, text in
            self?.presentComposer(title: title, url: url, text: text)
        }
    }

    private func extractSharedContent(completion: @escaping (String, URL?, String?) -> Void) {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let contentText = items
            .compactMap { $0.attributedContentText?.string }
            .first { !$0.trimmingCharacters(in: .whitespaces).isEmpty }

        let providers = items.flatMap { $0.attachments ?? [] }

        if let urlProvider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            urlProvider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                let url = item as? URL ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
                DispatchQueue.main.async {
                    let title = contentText ?? url?.host ?? ""
                    completion(title, url, nil)
                }
            }
            return
        }

        if let textProvider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            textProvider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                let text = (item as? String) ?? contentText
                DispatchQueue.main.async {
                    // Short text becomes the title; long text goes to notes.
                    let trimmed = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    if trimmed.count <= 120 {
                        completion(trimmed, nil, nil)
                    } else {
                        completion(String(trimmed.prefix(120)), nil, trimmed)
                    }
                }
            }
            return
        }

        DispatchQueue.main.async { completion(contentText ?? "", nil, nil) }
    }

    private func presentComposer(title: String, url: URL?, text: String?) {
        let compose = TaskComposeView(
            initialTitle: title,
            initialNotes: text ?? "",
            sharedURL: url
        ) { [weak self] _ in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
        let host = UIHostingController(rootView: compose)
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }
}
