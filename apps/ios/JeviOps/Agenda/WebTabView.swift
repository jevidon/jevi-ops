import SwiftUI

/// The Agenda tab and every web destination: the in-app web shell, kept
/// mounted for the life of the app. The web renders its own masthead and
/// content; only its mobile tab bar is hidden (native chrome replaces it).
/// Unreachable server → the calm offline card, styled like the app.
struct AgendaView: View {
    @ObservedObject var shell: ShellState
    var onSettings: () -> Void
    @EnvironmentObject private var config: AppConfig

    var body: some View {
        ZStack(alignment: .top) {
            // Full-bleed at the bottom only: the page pads for the bar itself,
            // but its masthead expects to start below the status bar.
            WebShellView(state: shell, onShake: onSettings)
                .ignoresSafeArea(edges: .bottom)
            if !shell.isHome {
                webCrumb
            }
            if let message = shell.offlineMessage {
                ShellOfflineCard(message: message, onRetry: { Task { await retry() } }, onSettings: onSettings)
            }
        }
    }

    /// A slim native back affordance while the shell is away from home, so a
    /// More destination never strands the user without the web's own nav.
    private var webCrumb: some View {
        HStack(spacing: 6) {
            Button(action: { shell.load(path: "/") }) {
                HStack(spacing: 6) {
                    Icon(name: .arrow, size: 12, color: Theme.ink3).rotationEffect(.degrees(180))
                    Text("Agenda").font(Typeface.mono(10, .semibold)).tracking(0.8).textCase(.uppercase)
                }
                .foregroundStyle(Theme.ink3)
                .padding(.horizontal, 10).frame(height: 26)
                .background(Theme.surface.opacity(0.92), in: Capsule())
                .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
    }

    private func retry() async {
        if let api = config.apiURL {
            do { try await APIClient(baseURL: api).checkHealth() }
            catch { shell.offlineMessage = error.localizedDescription; return }
        }
        shell.offlineMessage = nil
        shell.reloadFromOrigin()
    }
}

struct ShellOfflineCard: View {
    var message: String
    var onRetry: () -> Void
    var onSettings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScreenHeader(eyebrow: "Agenda", title: "The server is out of reach")
            VStack(alignment: .leading, spacing: 14) {
                Text(message).font(Typeface.sans(14)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                Text("Domains, Search and Capture keep working from what is saved on this phone. The Agenda needs the server.")
                    .font(Typeface.sans(13)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    ActionButton(label: "Retry", variant: .solid, action: onRetry)
                    ActionButton(label: "Settings", variant: .ghost, action: onSettings)
                }
            }
            .padding(.horizontal, 20)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.bg)
    }
}
