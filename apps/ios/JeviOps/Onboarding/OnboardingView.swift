import SwiftUI
import UIKit

/// First-run setup and the "Re-link device" flow from Settings, in the
/// Almanac's own dress: server address, then email + password exchanged for a
/// session JWT (memory only) that mints a revocable `ops_` device token into
/// the Keychain. The web view's cookie session is separate — sign in at
/// /sign-in once.
struct OnboardingView: View {
    @EnvironmentObject private var config: AppConfig
    var onComplete: (() -> Void)?

    @State private var webURL = ""
    @State private var apiURL = ""
    @State private var apiURLEdited = false
    @State private var email = ""
    @State private var password = ""
    @State private var working = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 12).fill(Theme.accent).frame(width: 44, height: 44)
                        .overlay(AlmanacMark(size: 30))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Almanac").font(Typeface.serif(24, .medium)).foregroundStyle(Theme.ink)
                        Eyebrow(text: "A Jevi operation")
                    }
                }
                .padding(.horizontal, 20).padding(.top, 28)
                ScreenHeader(eyebrow: "Set up this phone", title: "Where does your Almanac live?")
                VStack(alignment: .leading, spacing: 18) {
                    FieldGroup(label: "Web address") {
                        TextField("https://nas.tailnet.ts.net", text: $webURL)
                            .textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .font(Typeface.sans(15)).bordered()
                            .onChange(of: webURL) { _, newValue in
                                guard !apiURLEdited else { return }
                                apiURL = AppConfig.deriveApiURL(fromWebURL: normalized(newValue))
                            }
                    }
                    FieldGroup(label: "API address") {
                        TextField("API URL", text: $apiURL, onEditingChanged: { began in if began { apiURLEdited = true } })
                            .textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .font(Typeface.sans(15)).foregroundStyle(Theme.ink2).bordered()
                        Text("Derived from the web address: port 8443 on the tailnet, 3001 for local dev.")
                            .font(Typeface.sans(12)).foregroundStyle(Theme.ink3)
                    }
                    Hairline().padding(.vertical, 4)
                    Eyebrow(text: "Link this device")
                    FieldGroup(label: "Email") {
                        TextField("Email", text: $email)
                            .textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .font(Typeface.sans(15)).bordered()
                    }
                    FieldGroup(label: "Password") {
                        SecureField("Password", text: $password).textContentType(.password).font(Typeface.sans(15)).bordered()
                        Text("Creates a device token for capture, the share sheet and quick actions. Revoke it any time under Settings → API tokens on the web.")
                            .font(Typeface.sans(12)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
                    }
                    if let errorMessage {
                        Text(errorMessage).font(Typeface.sans(13)).foregroundStyle(Theme.accent).fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 8) {
                        ActionButton(label: working ? "Connecting…" : "Connect & link device", variant: .solid) { Task { await connect() } }
                            .disabled(working || webURL.isEmpty || email.isEmpty || password.isEmpty)
                            .accessibilityLabel("Connect & Link Device")
                        ActionButton(label: "Skip — just open the app", variant: .ghost) { saveURLs(); finish() }
                            .disabled(working || webURL.isEmpty)
                    }
                    .padding(.top, 4)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .background(Theme.bg)
        .interactiveDismissDisabled(working)
        .onAppear {
            webURL = config.webBaseURL
            apiURL = config.apiBaseURL
            apiURLEdited = !apiURL.isEmpty && apiURL != AppConfig.deriveApiURL(fromWebURL: config.webBaseURL)
        }
    }

    private func normalized(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        return trimmed.contains("://") ? trimmed : "https://\(trimmed)"
    }

    private func saveURLs() {
        config.webBaseURL = normalized(webURL)
        config.apiBaseURL = normalized(apiURL)
    }

    private func connect() async {
        working = true
        errorMessage = nil
        defer { working = false }
        saveURLs()
        guard let api = config.apiURL else { errorMessage = "That server URL doesn't look valid."; return }
        var client = APIClient(baseURL: api)
        do {
            try await client.checkHealth()
            let jwt = try await client.login(email: email, password: password)
            client.bearer = jwt
            let deviceName = await UIDevice.current.name
            let opsToken = try await client.mintDeviceToken(named: "iPhone – \(deviceName)")
            KeychainStore.setDeviceToken(opsToken)
            password = ""
            await ReferenceCache.refresh()
            finish()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func finish() {
        config.onboarded = true
        onComplete?()
    }
}
