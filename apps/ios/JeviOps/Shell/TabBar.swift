import SwiftUI

/// The five-slot mobile bar (BottomTabBar.tsx): row capped at 352pt and
/// centred so the targets sit in thumb range, opaque surface, hairline top,
/// and the Almanac mark rising out of the bar on a rust tile ringed in linen.
struct TabBar: View {
    static let height: CGFloat = 58

    var active: ShellTab
    var moreActive: Bool
    var recording: Bool
    var onTab: (ShellTab) -> Void
    var onCapture: () -> Void
    var onRecord: () -> Void
    var onMore: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Hairline()
            HStack(spacing: 0) {
                item(.agenda, "Agenda", .agenda, isActive: active == .agenda && !moreActive)
                item(.domains, "Domains", .domains, isActive: active == .domains)
                star
                item(.search, "Search", .search, isActive: active == .search)
                Button(action: onMore) {
                    label("More", .more, isActive: moreActive)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
                .accessibilityLabel("More")
            }
            .frame(maxWidth: 352)
            .frame(height: Self.height)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.surface.ignoresSafeArea(edges: .bottom))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tabBar")
    }

    private func item(_ tab: ShellTab, _ title: String, _ icon: IconName, isActive: Bool) -> some View {
        Button(action: { onTab(tab) }) { label(title, icon, isActive: isActive) }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .accessibilityLabel(title)
            .accessibilityAddTraits(isActive ? [.isSelected] : [])
    }

    private func label(_ title: String, _ icon: IconName, isActive: Bool) -> some View {
        VStack(spacing: 2) {
            Icon(name: icon, size: 22, color: isActive ? Theme.ink : Theme.ink3)
            Text(title).font(Typeface.sans(11, isActive ? .semibold : .medium)).foregroundStyle(isActive ? Theme.ink : Theme.ink3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
    }

    /// Tap → capture portal; long-press → start recording straight away.
    private var star: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 15)
                .fill(Theme.accent)
                .frame(width: 54, height: 54)
                .overlay(RoundedRectangle(cornerRadius: 15).stroke(Theme.linen, lineWidth: 3))
                .shadow(color: Color.black.opacity(0.16), radius: 7, y: 4)
                .opacity(0.9)
            AlmanacMark(size: 36, recording: recording)
        }
        .offset(y: -18)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { onCapture() }
        .onLongPressGesture(minimumDuration: 0.45) { onRecord() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(recording ? "Stop recording" : "Capture")
        .accessibilityIdentifier("captureStar")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onCapture() }
    }
}

/// The fixed bubble above the bar while a star-triggered recording runs with
/// the portal closed: elapsed time, stop & save, discard.
struct ListeningBubble: View {
    @ObservedObject var model: OfflineModel
    @State private var started = Date()
    @State private var elapsed = 0

    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(Theme.accent).frame(width: 8, height: 8)
            Text("Listening").font(Typeface.sans(14, .medium)).foregroundStyle(Theme.ink)
            Text(formatElapsed(elapsed)).font(Typeface.mono(12)).foregroundStyle(Theme.ink3)
            Spacer()
            Button("Stop & save") { model.stopRecording() }
                .font(Typeface.mono(10, .semibold)).tracking(0.7).textCase(.uppercase)
                .foregroundStyle(Theme.bg)
                .padding(.horizontal, 10).frame(height: 28)
                .background(Theme.ink, in: RoundedRectangle(cornerRadius: 4))
                .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.lineStrong, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.12), radius: 12, y: 6)
        .padding(.horizontal, 16)
        .padding(.bottom, 26)
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in
            elapsed = Int(Date().timeIntervalSince(started))
        }
    }
}
