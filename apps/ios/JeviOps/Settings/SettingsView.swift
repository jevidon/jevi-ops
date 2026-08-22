import SwiftUI

/// Reached by shaking the device (or from the offline screen). Server URLs,
/// device-link state, and the picker cache.
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
            Form {
                Section("Server") {
                    TextField("Web URL", text: $config.webBaseURL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                    TextField("API URL", text: $config.apiBaseURL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                    Button("Reload page") {
                        onReload()
                        dismiss()
                    }
                }

                Section {
                    LabeledContent("Status", value: linked ? "Linked" : "Not linked")
                    Button(linked ? "Re-link device…" : "Link device…") {
                        showRelink = true
                    }
                    if linked {
                        Button("Unlink device", role: .destructive) {
                            KeychainStore.deleteDeviceToken()
                            linked = false
                        }
                    }
                } header: {
                    Text("Device token")
                } footer: {
                    Text("The share sheet and quick actions use a device token (revocable under Settings → API tokens on the web). The web view signs in separately.")
                }

                Section {
                    LabeledContent("Cached", value: cacheInfo)
                    Button(refreshingCache ? "Refreshing…" : "Refresh domains & projects") {
                        refreshingCache = true
                        Task {
                            await ReferenceCache.refresh()
                            cacheInfo = SettingsView.describeCache()
                            refreshingCache = false
                        }
                    }
                    .disabled(refreshingCache || !linked)
                } header: {
                    Text("Share-sheet pickers")
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .sheet(isPresented: $showRelink) {
            OnboardingView(onComplete: {
                linked = KeychainStore.deviceToken != nil
                cacheInfo = SettingsView.describeCache()
                showRelink = false
            })
            .environmentObject(config)
        }
    }

    private static func describeCache() -> String {
        guard let cached = ReferenceCache.load() else { return "empty" }
        let when = cached.fetchedAt.formatted(.relative(presentation: .named))
        return "\(cached.domains.count) domains, \(cached.projects.count) projects (\(when))"
    }
}
