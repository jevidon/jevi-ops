import SwiftUI

// Shared editorial components, mirrored from the web: ScreenHeader, Pill,
// eyebrow labels, hairlines, the list-page action buttons, DetailShell's
// header band and stat strip. Sizes are the web's px values.

struct Eyebrow: View {
    var text: String
    var color: Color = Theme.ink3
    var body: some View {
        Text(text.uppercased())
            .font(Typeface.mono(10, .semibold))
            .tracking(1)
            .foregroundStyle(color)
    }
}

struct Hairline: View {
    var strong = false
    var body: some View {
        Rectangle().fill(strong ? Theme.lineStrong : Theme.line).frame(height: 1)
    }
}

/// Eyebrow + display-serif title + optional mono meta — the header every tab
/// shares (ScreenHeader.tsx).
struct ScreenHeader: View {
    var eyebrow: String
    var title: String
    var meta: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Eyebrow(text: eyebrow).padding(.bottom, 8)
            Text(title)
                .font(Typeface.serif(28, .medium))
                .tracking(-0.4)
                .lineSpacing(1)
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let meta {
                Text(meta).font(Typeface.mono(11)).foregroundStyle(Theme.ink3).padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 32)
        .padding(.bottom, 20)
    }
}

enum Urgency: String, Codable, CaseIterable {
    case over, due, ok, quiet

    var label: String {
        switch self {
        case .over: return "Overdue"
        case .due: return "Due today"
        case .ok: return "On track"
        case .quiet: return "Quiet"
        }
    }
}

/// The v2 status pill (Pill.tsx): four urgency states plus solid/plain chips.
struct Pill: View {
    enum Variant { case urgency(Urgency), solid, plain }
    var variant: Variant
    var label: String?
    var dot = true
    var fill = false

    init(_ urgency: Urgency, label: String? = nil, dot: Bool = true, fill: Bool = false) {
        variant = .urgency(urgency); self.label = label; self.dot = dot; self.fill = fill
    }
    init(_ variant: Variant, label: String, dot: Bool = false) {
        self.variant = variant; self.label = label; self.dot = dot
    }

    private var colors: (text: Color, background: Color, border: Color) {
        switch variant {
        case .urgency(.over): return (Theme.accent, Theme.accentSoft, Theme.accentLine)
        case .urgency(.due): return (Theme.warn, Theme.warnSoft, Theme.warnLine)
        case .urgency(.ok): return (Theme.good, Theme.goodSoft, Theme.goodLine)
        case .urgency(.quiet): return (Theme.ink3, .clear, Theme.lineStrong)
        case .solid: return (Theme.bg, Theme.accent, Theme.accent)
        case .plain: return (Theme.ink2, Theme.surface2, .clear)
        }
    }

    var body: some View {
        let c = colors
        let text: String = {
            if let label { return label }
            if case .urgency(let u) = variant { return u.label }
            return ""
        }()
        HStack(spacing: 5) {
            if dot { Circle().fill(c.text).frame(width: 5, height: 5) }
            Text(text.uppercased()).font(Typeface.mono(9.5, .semibold)).tracking(0.7).lineLimit(1)
        }
        .foregroundStyle(c.text)
        .padding(.horizontal, 8)
        .frame(height: 20)
        .frame(maxWidth: fill ? .infinity : nil)
        .background(c.background, in: Capsule())
        .overlay(Capsule().stroke(c.border, lineWidth: 1))
    }
}

/// The list-page / detail-page button (34px, mono uppercase). ghost = outline,
/// solid = ink, accent = rust.
struct ActionButton: View {
    enum Variant { case ghost, solid, accent }
    var label: String
    var variant: Variant = .ghost
    var icon: IconName?
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Icon(name: icon, size: 14, color: foreground) }
                Text(label.uppercased()).font(Typeface.mono(10, .semibold)).tracking(0.7)
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(background, in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var foreground: Color { variant == .ghost ? Theme.ink2 : Theme.bg }
    private var background: Color {
        switch variant { case .ghost: return Theme.bg; case .solid: return Theme.ink; case .accent: return Theme.accent }
    }
    private var border: Color {
        switch variant { case .ghost: return Theme.lineStrong; case .solid: return Theme.ink; case .accent: return Theme.accent }
    }
}

/// The inline mono text action ("Open domain →", "+ Project").
struct TextAction: View {
    var label: String
    var trailing: String?
    var underline = false
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(label).font(Typeface.mono(11)).underline(underline)
                if let trailing { Text(trailing).font(Typeface.mono(11)) }
            }
            .foregroundStyle(Theme.ink2)
            .frame(minHeight: 44)
            .padding(.horizontal, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// DetailShell's header band: crumb line · serif name with a colour dot ·
/// state pill · actions row.
struct DetailHeader<Actions: View>: View {
    var crumb: [String]
    var name: String
    var color: Color?
    var state: Urgency?
    var stateLabel: String?
    var titleSize: CGFloat = 34
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                ForEach(Array(crumb.enumerated()), id: \.offset) { index, part in
                    if index > 0 { Text("·").foregroundStyle(Theme.ink4) }
                    Text(part.uppercased())
                }
            }
            .font(Typeface.mono(10))
            .tracking(1.1)
            .foregroundStyle(Theme.ink3)
            HStack(alignment: .center, spacing: 12) {
                if let color { Circle().fill(color).frame(width: 12, height: 12) }
                Text(name)
                    .font(Typeface.serif(titleSize, .medium))
                    .tracking(-0.7)
                    .lineSpacing(-2)
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let state { Pill(state, label: stateLabel) }
            }
            .padding(.top, 12)
            let row = HStack(spacing: 8) { actions() }
            row.padding(.top, 14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .padding(.bottom, 20)
        .background(Theme.surface)
        .overlay(alignment: .bottom) { Hairline(strong: true) }
    }
}

/// A computed stat tile; `tone` turns the whole tile accent/warn when its
/// number is a problem.
struct StatTile: View {
    var label: String
    var value: String
    var unit: String?
    var sub: String?
    var tone: Tone = .neutral
    enum Tone { case neutral, accent, warn }

    var body: some View {
        let toneColor: Color = tone == .accent ? Theme.accent : tone == .warn ? Theme.warn : Theme.ink3
        VStack(alignment: .leading, spacing: 0) {
            Eyebrow(text: label, color: toneColor).padding(.bottom, 8)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value).font(Typeface.serif(26, .medium)).foregroundStyle(tone == .neutral ? Theme.ink : toneColor)
                if let unit { Text(unit).font(Typeface.mono(10)).foregroundStyle(Theme.ink3) }
            }
            if let sub { Text(sub).font(Typeface.mono(10)).foregroundStyle(Theme.ink3).padding(.top, 4).lineLimit(2) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }
}

/// Two tiles per row, hairlines between, mirroring StatStrip on a phone.
struct StatStrip: View {
    var tiles: [StatTile]
    var body: some View {
        let rows = stride(from: 0, to: tiles.count, by: 2).map { Array(tiles[$0..<min($0 + 2, tiles.count)]) }
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack(spacing: 0) {
                    ForEach(Array(row.enumerated()), id: \.offset) { column, tile in
                        tile
                        if column == 0, row.count == 2 { Rectangle().fill(Theme.line).frame(width: 1) }
                    }
                }
                if index < rows.count - 1 { Hairline() }
            }
        }
        .background(Theme.bg)
        .overlay(alignment: .bottom) { Hairline(strong: true) }
    }
}

struct SectionEyebrow: View {
    var title: String
    var count: Int?
    var body: some View {
        HStack {
            Eyebrow(text: title)
            Spacer()
            if let count { Text(String(count)).font(Typeface.mono(11)).foregroundStyle(Theme.ink3) }
        }
        .padding(.top, 24)
        .padding(.bottom, 8)
        .overlay(alignment: .bottom) { Hairline() }
    }
}

struct EmptyNote: View {
    var text: String
    var body: some View {
        Text(text).font(Typeface.sans(13)).italic().foregroundStyle(Theme.ink3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 12)
    }
}

/// The card shell the Work board's project and asset cards share: a 3px
/// domain-colour cap, hairline border, canvas background.
struct CardShell<Content: View>: View {
    var color: Color
    var flagged = false
    var dimmed = false
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(color).frame(height: 3)
            content()
                .padding(.horizontal, 14)
                .padding(.top, 14)
                .padding(.bottom, 12)
        }
        .background(Theme.bg)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(flagged ? Theme.accentHalf : Theme.line, lineWidth: 1))
        .opacity(dimmed ? 0.6 : 1)
    }
}

/// A grey notice line ("Showing saved data…") used across native screens.
struct Notice: View {
    var text: String
    var tone: Tone = .quiet
    enum Tone { case quiet, warn, error }
    var body: some View {
        Text(text)
            .font(Typeface.sans(13))
            .foregroundStyle(tone == .error ? Theme.accent : tone == .warn ? Theme.warn : Theme.ink3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
    }
}

struct PlainListRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Theme.inkWash : .clear)
    }
}

/// A single-line text field styled like the web's FilterInput.
struct EditorialField: View {
    var placeholder: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default
    var body: some View {
        TextField(placeholder, text: $text)
            .font(Typeface.sans(14))
            .foregroundStyle(Theme.ink)
            .keyboardType(keyboard)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .padding(.horizontal, 12)
            .frame(height: 38)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.lineStrong, lineWidth: 1))
    }
}

/// Labelled form field used by the native editors — eyebrow label above a
/// bordered control, matching the web's edit drawer forms.
struct FieldGroup<Content: View>: View {
    var label: String
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: label)
            content()
        }
    }
}

struct BorderedControl: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.lineStrong, lineWidth: 1))
    }
}

extension View {
    func bordered() -> some View { modifier(BorderedControl()) }
}

/// Relative due-date label, mirroring TaskItem.tsx: "Due today", "Overdue 3d",
/// "Due tomorrow", "Due Fri", "Due Fri Jun 6".
enum DueLabel {
    enum Kind { case overdue, today, future }

    static func format(_ dueIso: String, today: String) -> (kind: Kind, text: String)? {
        guard let due = day(dueIso), let now = day(today) else { return nil }
        if dueIso == today { return (.today, "Due today") }
        let days = Calendar(identifier: .gregorian).dateComponents([.day], from: now, to: due).day ?? 0
        if days < 0 { return (.overdue, "Overdue \(-days)d") }
        if days == 1 { return (.future, "Due tomorrow") }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = days < 7 ? "EEE" : "EEE MMM d"
        return (.future, "Due \(formatter.string(from: due))")
    }

    static func daysBetween(_ fromIso: String, _ toIso: String) -> Int? {
        guard let from = day(fromIso), let to = day(toIso) else { return nil }
        return Calendar(identifier: .gregorian).dateComponents([.day], from: from, to: to).day
    }

    private static func day(_ iso: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(iso.prefix(10)))
    }

    /// Today's date in the app's timezone (a DB setting the snapshot carries),
    /// never the phone's zone — a date assertion made in the wrong zone reads
    /// a day off every evening.
    static func today(in timezone: String?) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timezone.flatMap(TimeZone.init(identifier:)) ?? TimeZone(identifier: "America/Denver")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }
}
