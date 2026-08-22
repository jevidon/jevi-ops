import SwiftUI
import UIKit

/// First-run setup and the "Re-link device" flow from Settings.
///
/// Exchanges email+password for a session JWT (held in memory only), then
/// immediately mints a long-lived revocable `ops_` device token via
/// POST /api/auth/tokens and stores it in the Keychain. The web view's
/// cookie session is separate — the user still signs in at /sign-in once.
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
        NavigationStack {
            Form {
                Section {
                    TextField("https://nas.tailnet.ts.net", text: $webURL)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        .onChange(of: webURL) { _, newValue in
                            guard !apiURLEdited else { return }
                            apiURL = AppConfig.deriveApiURL(fromWebURL: normalized(newValue))
                        }
                    // Editing this field by hand stops auto-derivation from
                    // the web URL; programmatic derivation must not trip it.
                    TextField("API URL", text: $apiURL, onEditingChanged: { began in
                        if began { apiURLEdited = true }
                    })
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        .foregroundStyle(.secondary)
                } header: {
                    Text("Server")
                } footer: {
                    Text("Your jevi-ops web address. The API address is derived automatically (port 8443 on the tailnet).")
                }

                Section {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                } header: {
                    Text("Link this device")
                } footer: {
                    Text("Creates a device token for the share sheet and quick actions. You can revoke it any time in Settings → API tokens on the web.")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.callout)
                    }
                }

                Section {
                    Button(action: { Task { await connect() } }) {
                        if working {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Connect & Link Device").frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(working || webURL.isEmpty || email.isEmpty || password.isEmpty)

                    Button("Skip — just open the app") {
                        saveURLs()
                        finish()
                    }
                    .disabled(working || webURL.isEmpty)
                    .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("jevi-ops")
        }
        .interactiveDismissDisabled(working)
        .onAppear {
            webURL = config.webBaseURL
            apiURL = config.apiBaseURL
            apiURLEdited = !apiURL.isEmpty
                && apiURL != AppConfig.deriveApiURL(fromWebURL: config.webBaseURL)
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
        guard let api = config.apiURL else {
            errorMessage = "That server URL doesn't look valid."
            return
        }

        var client = APIClient(baseURL: api)
        guard await client.healthz() else {
            errorMessage = "No response from \(api.absoluteString)/healthz. Check the URL and that Tailscale is connected."
            return
        }

        do {
            let jwt = try await client.login(email: email, password: password)
            client.bearer = jwt
            let deviceName = await UIDevice.current.name
            let opsToken = try await client.mintDeviceToken(named: "iPhone – \(deviceName)")
            KeychainStore.setDeviceToken(opsToken)
            password = ""

            // Seed the picker cache while we're online.
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
