import SwiftUI

/// Device & server: the web and API addresses, the device-token link, and the
/// share-sheet picker cache. Reached from More, from a shake on the Agenda,
/// and from the offline card.
struct SettingsView: View {
    @EnvironmentObject private var config: AppConfig
    @Environment(\.dismiss) private var dismiss
    var onReload: () -> Void

    @State private var linked = KeychainStore.deviceToken != nil
    @State private var showRelink = false
    @State private var cacheInfo = SettingsView.describeCache()
    @State private var refreshingCache = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ScreenHeader(eyebrow: "This phone", title: "Device & server")
                    VStack(alignment: .leading, spacing: 18) {
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
                        ActionButton(label: "Reload the Agenda", variant: .ghost, icon: .arrow) { onReload(); dismiss() }

                        Hairline().padding(.vertical, 4)
                        Eyebrow(text: "Device token")
                        HStack(spacing: 10) {
                            Pill(linked ? .ok : .quiet, label: linked ? "Linked" : "Not linked")
                            Text("Capture, the share sheet and quick actions use a revocable device token. The Agenda's web view signs in separately.")
                                .font(Typeface.sans(12)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
                        }
                        HStack(spacing: 8) {
                            ActionButton(label: linked ? "Re-link device…" : "Link device…", variant: .solid) { showRelink = true }
                            if linked {
                                ActionButton(label: "Unlink", variant: .ghost) { KeychainStore.deleteDeviceToken(); linked = false }
                            }
                        }

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
