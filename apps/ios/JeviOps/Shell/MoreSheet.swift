import SwiftUI

/// The "More" bottom sheet: every route the desktop rail exposes, in the
/// web's order, plus what only the phone has — saved captures and the device
/// link. Items open inside the in-app web shell.
struct MoreSheet: View {
    var currentPath: String
    var onOpen: (String) -> Void
    var onCaptures: () -> Void
    var onSettings: () -> Void
    @Environment(\.dismiss) private var dismiss

    private let items: [(path: String, label: String, icon: IconName)] = [
        ("/library", "Library", .library), ("/content", "Content", .content), ("/people", "People", .people),
        ("/tasks", "Tasks", .tasks), ("/companies", "Companies", .companies), ("/routines", "Routines", .routines),
        ("/maintenance", "Maintenance", .maintenance), ("/chat", "Ask", .ask), ("/attention", "Attention", .flag),
        ("/notifications", "Notifications", .bell), ("/settings", "Settings", .gear),
    ]

    var body: some View {
        VStack(spacing: 0) {
            Capsule().fill(Theme.lineStrong).frame(width: 36, height: 4).padding(.top, 10).padding(.bottom, 4)
            HStack {
                Eyebrow(text: "More")
                Spacer()
                Button("Close") { dismiss() }
                    .font(Typeface.mono(10)).tracking(0.8).textCase(.uppercase).foregroundStyle(Theme.ink3)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 10)
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(items, id: \.path) { item in
                        let active = currentPath == item.path || currentPath.hasPrefix(item.path + "/")
                        row(item.label, item.icon, active: active) { onOpen(item.path) }
                    }
                    Hairline().padding(.vertical, 8)
                    Eyebrow(text: "This phone").padding(.horizontal, 12).padding(.vertical, 8)
                    row("Saved captures", .note, active: false, action: onCaptures)
                    row("Device & server", .gear, active: false, action: onSettings)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }
        }
        .background(Theme.bg)
    }

    private func row(_ label: String, _ icon: IconName, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Icon(name: icon, size: 20, color: active ? Theme.bg : Theme.ink).frame(width: 22)
                Text(label).font(Typeface.sans(15)).foregroundStyle(active ? Theme.bg : Theme.ink)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .background(active ? Theme.ink : .clear, in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
