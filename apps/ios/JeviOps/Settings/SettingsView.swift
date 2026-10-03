import SwiftUI

/// Settings — the phone's own: appearance (mirrored into the web's theme
/// cookie so both surfaces match), the device link and server addresses,
/// the share-sheet cache. Everything the web configures server-side
/// (password, timezone, modules, Agenda panels, AI, tokens, integrations)
/// opens on the web, one row each, in the web's order.
struct SettingsView: View {
    @EnvironmentObject private var config: AppConfig
    @Environment(\.dismiss) private var dismiss
    var onReload: () -> Void
    var onTheme: (String) -> Void = { _ in }
    var onWeb: (String) -> Void = { _ in }

    @State private var linked = KeychainStore.deviceToken != nil
    @State private var showRelink = false
    @State private var cacheInfo = SettingsView.describeCache()
    @State private var refreshingCache = false

    private let webSections: [(String, String)] = [
        ("Password", "/settings#password"), ("Timezone", "/settings#timezone"), ("Modules", "/settings#modules"),
        ("Maintenance", "/settings#maintenance"), ("Agenda · panels", "/settings#agenda"),
        ("AI · language model, transcription, photos", "/settings#ai"), ("API tokens · agents & devices", "/settings#tokens"),
        ("Integration status", "/settings#integrations"), ("Google Calendar", "/settings#calendar"),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ScreenHeader(eyebrow: "Account", title: "Settings", meta: "This phone · the web")
                    VStack(alignment: .leading, spacing: 18) {
                        Eyebrow(text: "Appearance")
                        HStack(spacing: 0) {
                            ForEach([("light", "Light"), ("system", "System"), ("dark", "Dark")], id: \.0) { value, label in
                                Button { config.theme = value; onTheme(value) } label: {
                                    Text(label.uppercased()).font(Typeface.mono(10)).tracking(0.8)
                                        .foregroundStyle(config.theme == value ? Theme.bg : Theme.ink2)
                                        .padding(.horizontal, 16).frame(height: 34)
                                        .background(config.theme == value ? Theme.ink : .clear)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(label)
                                .accessibilityAddTraits(config.theme == value ? [.isSelected] : [])
                                if value != "dark" { Rectangle().fill(Theme.lineStrong).frame(width: 1, height: 34) }
                            }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.lineStrong, lineWidth: 1))
                        Text("System follows this phone’s appearance. The web pages inside the app follow the same choice.")
                            .font(Typeface.sans(12)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)

                        Hairline().padding(.vertical, 4)
                        Eyebrow(text: "Device token")
                        HStack(spacing: 10) {
                            Pill(linked ? .ok : .quiet, label: linked ? "Linked" : "Not linked")
                            Text("Capture, sync, the share sheet and quick actions use a revocable device token.")
                                .font(Typeface.sans(12)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
                        }
                        HStack(spacing: 8) {
                            ActionButton(label: linked ? "Re-link device…" : "Link device…", variant: .solid) { showRelink = true }
                            if linked {
                                ActionButton(label: "Unlink", variant: .ghost) { KeychainStore.deleteDeviceToken(); linked = false }
                            }
                        }

                        Hairline().padding(.vertical, 4)
                        Eyebrow(text: "Server")
                        FieldGroup(label: "Web address") {
                            TextField("https://nas.tailnet.ts.net", text: $config.webBaseURL)
                                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .font(Typeface.sans(15)).bordered()
                        }
                        FieldGroup(label: "API address") {
                            TextField("API URL", text: $config.apiBaseURL)
                                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .font(Typeface.sans(15)).bordered()
                        }
                        ActionButton(label: "Reload web pages", variant: .ghost, icon: .arrow) { onReload(); dismiss() }

                        Hairline().padding(.vertical, 4)
                        Eyebrow(text: "Share-sheet pickers")
                        Text("Cached: \(cacheInfo)").font(Typeface.mono(11)).foregroundStyle(Theme.ink3)
                        ActionButton(label: refreshingCache ? "Refreshing…" : "Refresh domains & projects", variant: .ghost) {
                            refreshingCache = true
                            Task {
                                await ReferenceCache.refresh()
                                cacheInfo = SettingsView.describeCache()
                                refreshingCache = false
                            }
                        }
                        .disabled(refreshingCache || !linked)

                        Hairline().padding(.vertical, 4)
                        Eyebrow(text: "On the web")
                        VStack(spacing: 0) {
                            ForEach(webSections, id: \.1) { label, path in
                                Button { dismiss(); onWeb(path) } label: {
                                    HStack {
                                        Text(label).font(Typeface.sans(14)).foregroundStyle(Theme.ink)
                                        Spacer()
                                        Icon(name: .chev, size: 14, color: Theme.ink4)
                                    }
                                    .padding(.vertical, 10)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .overlay(alignment: .bottom) { Hairline() }
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 40)
                }
            }
            .background(Theme.bg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.surface, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(isPresented: $showRelink, onDismiss: { linked = KeychainStore.deviceToken != nil }) {
                OnboardingView(onComplete: { showRelink = false })
            }
        }
    }

    private static func describeCache() -> String {
        guard let payload = ReferenceCache.load() else { return "nothing yet" }
        let when = payload.fetchedAt.formatted(date: .abbreviated, time: .shortened)
        return "\(payload.domains.count) domains · \(payload.projects.count) projects · \(when)"
    }
}
