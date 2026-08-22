import SwiftUI

/// Full-screen calm state for when the tailnet (or the server) is down —
/// a normal situation for a self-hosted app, not an error condition.
struct OfflineView: View {
    let message: String
    var onRetry: () -> Void
    var onSettings: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(.secondary)
            Text("jevi-ops is unreachable")
                .font(.title3.weight(.semibold))
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button(action: onRetry) {
                Text("Retry")
                    .frame(maxWidth: 200)
            }
            .buttonStyle(.borderedProminent)
            Button("Settings", action: onSettings)
                .buttonStyle(.bordered)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
    }
}
