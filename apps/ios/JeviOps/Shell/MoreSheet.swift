import SwiftUI

/// The "More" bottom sheet: every route the desktop rail exposes, in the
/// web's order, plus what only the phone has — saved captures and the device
/// link. Items open inside the in-app web shell.
struct MoreSheet: View {
    var currentPath: String
    var flags: AgendaBundle.Settings?
    var badges: (attention: Int, unread: Int) = (0, 0)
    var onOpen: (String) -> Void
    var onCaptures: () -> Void
    var onSettings: () -> Void
    @Environment(\.dismiss) private var dismiss

    private var items: [(path: String, label: String, icon: IconName, badge: Int, accent: Bool)] {
        var list: [(String, String, IconName, Int, Bool)] = [
            ("/library", "Library", .library, 0, false), ("/content", "Content", .content, 0, false), ("/people", "People", .people, 0, false),
            ("/tasks", "Tasks", .tasks, 0, false), ("/companies", "Companies", .companies, 0, false),
        ]
        if flags?.routines_module_enabled ?? true { list.append(("/routines", "Routines", .routines, 0, false)) }
        if flags?.maintenance_module_enabled ?? true { list.append(("/maintenance", "Maintenance", .maintenance, 0, false)) }
        if flags?.health_module_enabled ?? false { list.append(("/health", "Health", .health, 0, false)) }
        list += [("/chat", "Ask", .ask, 0, false), ("/attention", "Attention", .flag, badges.attention, false),
                 ("/notifications", "Notifications", .bell, badges.unread, true)]
        return list.map { (path: $0.0, label: $0.1, icon: $0.2, badge: $0.3, accent: $0.4) }
    }

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
                        row(item.label, item.icon, active: active, badge: item.badge, accent: item.accent) { onOpen(item.path) }
                    }
                    row("Settings", .gear, active: false, action: onSettings)
                    Hairline().padding(.vertical, 8)
                    Eyebrow(text: "This phone").padding(.horizontal, 12).padding(.vertical, 8)
                    row("Saved captures", .note, active: false, action: onCaptures)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }
        }
        .background(Theme.bg)
    }

    private func row(_ label: String, _ icon: IconName, active: Bool, badge: Int = 0, accent: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Icon(name: icon, size: 20, color: active ? Theme.bg : Theme.ink).frame(width: 22)
                Text(label).font(Typeface.sans(15)).foregroundStyle(active ? Theme.bg : Theme.ink)
                Spacer()
                if badge > 0 {
                    Text(badge > 99 ? "99+" : String(badge)).font(Typeface.mono(10)).foregroundStyle(Theme.bg)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(active ? Theme.bg.opacity(0.2) : accent ? Theme.accent : Theme.ink, in: Capsule())
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .background(active ? Theme.ink : .clear, in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
