import SwiftUI

/// The Agenda — the editorial home screen, native. Masthead + focus line,
/// then the panels in the user's configured order (Settings → Agenda on the
/// web), main column first and the rail after it, exactly as the web stacks
/// them on a phone. Each panel renders from the one bundle and returns
/// nothing when it has nothing to say.
struct AgendaView: View {
    @ObservedObject var model: AgendaModel
    @ObservedObject var offline: OfflineModel
    var onWeb: (String) -> Void
    var onSettings: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                if let b = model.bundle {
                    VStack(alignment: .leading, spacing: 0) {
                        masthead(b)
                        Hairline(strong: true).padding(.horizontal, 20).padding(.top, 16)
                        if let focus = b.focus { focusLine(focus) }
                        if let message = model.message { Notice(text: message).padding(.top, 8) }
                        if b.briefing_failed == true { Notice(text: "Couldn’t load the briefing.") }
                        let enabled = b.panels.filter(\.enabled)
                        let ordered = enabled.filter { $0.column == "main" } + enabled.filter { $0.column == "rail" }
                        VStack(alignment: .leading, spacing: 36) {
                            ForEach(ordered) { entry in panel(entry.id, b) }
                        }
                        .padding(.top, 28)
                        if let fetched = b.fetchedAt {
                            Text("Last downloaded \(fetched.formatted(date: .abbreviated, time: .shortened))")
                                .font(Typeface.mono(10)).foregroundStyle(Theme.ink4).padding(.horizontal, 20).padding(.top, 32)
                        }
                    }
                    .padding(.bottom, 48)
                } else {
                    emptyState
                }
            }
            .background(Theme.bg)
            .refreshable { await model.refresh(force: true) }
            .navigationDestination(for: DomainRoute.self) { route in
                switch route {
                case .domain(let id): DomainDetailView(model: offline, domainID: id, onCompose: { _ in }, onWeb: onWeb)
                case .project(let id): ProjectDetailView(model: offline, projectID: id, onCompose: { _ in }, onWeb: onWeb)
                case .task(let id): TaskDetailView(model: offline, taskID: id, onWeb: onWeb)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .task { if model.bundle == nil || model.isStale { await model.refresh() } }
    }

    private func masthead(_ b: AgendaBundle) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Eyebrow(text: b.masthead.date_line)
                if b.masthead.unread > 0 {
                    Text(" · ").font(Typeface.mono(10, .semibold)).foregroundStyle(Theme.ink3)
                    Button { onWeb("/notifications") } label: {
                        Text("\(b.masthead.unread) UNREAD").font(Typeface.mono(10, .semibold)).tracking(1).foregroundStyle(Theme.accent)
                    }.buttonStyle(.plain)
                }
            }
            .padding(.bottom, 8)
            Text("The Almanac").font(Typeface.serif(40, .medium)).tracking(-0.9).foregroundStyle(Theme.ink)
            HStack(spacing: 8) {
                if b.counts.overdue > 0 { Pill(.over, label: "\(b.counts.overdue) overdue") }
                if b.counts.open > 0 { Pill(.due, label: "\(b.counts.open) open") }
                if b.counts.waiting > 0 { Pill(.quiet, label: "\(b.counts.waiting) waiting") }
                if b.settings.routines_module_enabled, b.counts.routines_total > 0 {
                    Pill(b.counts.routines_done >= b.counts.routines_total ? .ok : .quiet, label: "Routines \(b.counts.routines_done)/\(b.counts.routines_total)")
                }
            }
            .padding(.top, 12)
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
    }

    private func focusLine(_ focus: AgendaBundle.Focus) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Button { onWeb(focus.href) } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("FOCUS").font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3)
                    Text(focus.title).font(Typeface.sans(15)).foregroundStyle(Theme.ink)
                    Text("→").font(Typeface.mono(11)).foregroundStyle(Theme.ink3)
                }
            }.buttonStyle(.plain)
            if let note = focus.note { Text(note).font(Typeface.sans(12)).foregroundStyle(Theme.ink3) }
        }
        .padding(.horizontal, 20).padding(.top, 16)
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 12) {
            ScreenHeader(eyebrow: "Agenda", title: "The Almanac")
            Text(model.message ?? (offline.isLinked ? "Downloading today’s briefing…" : OfflineError.notLinked.localizedDescription))
                .font(Typeface.sans(14)).foregroundStyle(Theme.ink2).padding(.horizontal, 20).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                ActionButton(label: model.loading ? "Loading…" : "Retry", variant: .solid) { Task { await model.refresh(force: true) } }
                ActionButton(label: "Settings", variant: .ghost, action: onSettings)
            }.padding(.horizontal, 20)
        }
    }

    @ViewBuilder
    private func panel(_ id: String, _ b: AgendaBundle) -> some View {
        switch id {
        case "frame": if let url = b.settings.agenda_image_url { FramePanel(url: url) }
        case "weather": if b.settings.agenda_data_url != nil { WeatherPanel(weather: b.weather) }
        case "domain-pulse": if !b.domains.isEmpty { DomainPulsePanel(rows: b.domains, onWeb: onWeb) }
        case "silent-clients": if !b.attention.silent_clients.isEmpty { SilentClientsPanel(model: model, items: b.attention.silent_clients, onWeb: onWeb) }
        case "attention": if !b.attention.items.isEmpty { AttentionPanel(model: model, attention: b.attention, onWeb: onWeb) }
        case "reflection": ReflectionPanel(model: model, resurfacing: b.resurfacing, onWeb: onWeb)
        case "latest-quote":
            if let quote = b.briefing?.latest_quote, quote.id != b.resurfacing.item?.id { LatestQuotePanel(quote: quote, onWeb: onWeb) }
        case "pinned": if !b.pins.isEmpty { PinnedPanel(model: model, pins: b.pins, onWeb: onWeb) }
        case "agenda": if let agenda = b.agenda { TimelinePanel(model: model, agenda: agenda, onWeb: onWeb) }
        case "doing": DoingPanel(model: model, offline: offline, bundle: b, onWeb: onWeb)
        case "health": if let health = b.health { HealthPanel(health: health, onWeb: onWeb) }
        case "routines": RoutinesPanel(model: model, bundle: b, onWeb: onWeb)
        default: EmptyView()
        }
    }
}

// ─── Panel shell ─────────────────────────────────────────────────────────

/// PanelFrame.tsx: eyebrow row with an optional right-side action, then content.
struct PanelFrame<Content: View>: View {
    var eyebrow: String
    var action: (label: String, path: String)?
    var onWeb: ((String) -> Void)?
    var gap: CGFloat = 12
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: gap) {
            HStack(alignment: .firstTextBaseline) {
                Eyebrow(text: eyebrow)
                Spacer()
                if let action, let onWeb {
                    Button { onWeb(action.path) } label: {
                        Text(action.label.uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3)
                    }.buttonStyle(.plain)
                }
            }
            content()
        }
        .padding(.horizontal, 20)
    }
}

private struct PanelTextButton: View {
    var label: String
    var tone: Color = Theme.ink3
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label.uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(tone).frame(minHeight: 28)
        }.buttonStyle(.plain)
    }
}

private struct SmallOutlineButton: View {
    var label: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label.uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink2)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.lineStrong, lineWidth: 1))
        }.buttonStyle(.plain)
    }
}

// ─── Frame ───────────────────────────────────────────────────────────────

/// The hero image: a rotating feed, cache-busted on a five-minute bucket.
struct FramePanel: View {
    var url: String
    @State private var bucket = Int(Date().timeIntervalSince1970 / 300)
    @State private var failed = false

    var body: some View {
        let sep = url.contains("?") ? "&" : "?"
        Group {
            if failed || URL(string: "\(url)\(sep)t=\(bucket)") == nil {
                Text("FRAME UNAVAILABLE — IS THIS DEVICE ON THE SAME NETWORK?")
                    .font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(.vertical, 24)
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.line, lineWidth: 1))
            } else {
                AsyncImage(url: URL(string: "\(url)\(sep)t=\(bucket)")) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFit()
                    case .failure: Color.clear.frame(height: 1).onAppear { failed = true }
                    default: Rectangle().fill(Theme.surface2).frame(height: 180)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.line, lineWidth: 1))
            }
        }
        .padding(.horizontal, 20)
        .onReceive(Timer.publish(every: 300, on: .main, in: .common).autoconnect()) { _ in
            failed = false
            bucket = Int(Date().timeIntervalSince1970 / 300)
        }
    }
}

// ─── Weather ─────────────────────────────────────────────────────────────

struct WeatherPanel: View {
    var weather: AgendaBundle.Weather?

    var body: some View {
        let d = weather?.data
        PanelFrame(eyebrow: "Weather" + (d?.title.map { " · \($0)" } ?? "")) {
            if let d {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline, spacing: 20) {
                        if let temp = d.current_temperature {
                            HStack(alignment: .firstTextBaseline, spacing: 2) {
                                Text(temp.text).font(Typeface.serif(44, .medium)).tracking(-0.9).foregroundStyle(Theme.ink)
                                Text(d.temperature_unit ?? "°").font(Typeface.serif(22, .medium)).foregroundStyle(Theme.ink2)
                                if let alt = d.current_temperature_alt, let altUnit = d.temperature_unit_alt {
                                    Text("\(alt.text)\(altUnit)").font(Typeface.mono(11)).foregroundStyle(Theme.ink3).padding(.leading, 6)
                                }
                            }
                        }
                        if let updated = d.updated_at_text {
                            Spacer()
                            Text(updated.uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink4)
                        }
                    }
                    if let points = d.data_points, !points.isEmpty {
                        FlowLayout(spacing: 16) {
                            ForEach(Array(points.enumerated()), id: \.offset) { _, p in
                                HStack(alignment: .firstTextBaseline, spacing: 5) {
                                    Text(p.label.uppercased()).font(Typeface.mono(9)).tracking(0.7).foregroundStyle(Theme.ink4)
                                    Text("\(p.arrow.map { "\($0) " } ?? "")\(p.measurement.text)").font(Typeface.sans(13)).foregroundStyle(Theme.ink2)
                                    if let unit = p.unit { Text(unit).font(Typeface.sans(11)).foregroundStyle(Theme.ink3) }
                                }
                            }
                        }
                    }
                    if let hours = d.hourly_forecast, hours.count >= 2 {
                        TempCurve(hours: hours, unit: d.temperature_unit ?? "°").frame(height: 110)
                    }
                    if let days = d.forecast, !days.isEmpty {
                        Hairline()
                        HStack(alignment: .top, spacing: 8) {
                            ForEach(Array(days.prefix(5).enumerated()), id: \.offset) { _, day in
                                VStack(spacing: 2) {
                                    Text(day.day.uppercased()).font(Typeface.mono(9)).tracking(0.7).foregroundStyle(Theme.ink3)
                                    (Text("\(Int(day.high.rounded()))°").foregroundColor(Theme.ink) + Text("/").foregroundColor(Theme.ink4)
                                     + Text("\(Int(day.low.rounded()))°").foregroundColor(Theme.ink3)).font(Typeface.sans(13))
                                    if let rain = day.rain_pct, rain > 0 {
                                        Text("\(Int(rain))%").font(Typeface.mono(9)).foregroundStyle(Theme.prio3)
                                    }
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                    }
                }
            } else {
                Text("WEATHER DATA UNREACHABLE — IS THE FRAME ONLINE?").font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3).padding(.vertical, 4)
            }
        }
    }
}

/// The 24h temperature curve (temp-curve.tsx): accent line over a faint
/// area, min/max gridlines, extreme labels, three time ticks.
struct TempCurve: View {
    var hours: [AgendaBundle.Weather.Data.Hour]
    var unit: String

    var body: some View {
        Canvas { context, size in
            let temps = hours.map(\.temperature)
            guard let min = temps.min(), let max = temps.max() else { return }
            let span = Swift.max(max - min, 1)
            let padX: CGFloat = 4, padTop: CGFloat = 18, padBottom: CGFloat = 20
            func x(_ i: Int) -> CGFloat { padX + CGFloat(i) / CGFloat(hours.count - 1) * (size.width - padX * 2) }
            func y(_ t: Double) -> CGFloat { padTop + CGFloat(1 - (t - min) / span) * (size.height - padTop - padBottom) }
            for level in [max, min] {
                var grid = Path(); grid.move(to: CGPoint(x: padX, y: y(level))); grid.addLine(to: CGPoint(x: size.width - padX, y: y(level)))
                context.stroke(grid, with: .color(Theme.line), lineWidth: 1)
            }
            var line = Path()
            for (i, t) in temps.enumerated() { i == 0 ? line.move(to: CGPoint(x: x(i), y: y(t))) : line.addLine(to: CGPoint(x: x(i), y: y(t))) }
            var area = line
            area.addLine(to: CGPoint(x: x(hours.count - 1), y: size.height - padBottom))
            area.addLine(to: CGPoint(x: x(0), y: size.height - padBottom))
            area.closeSubpath()
            context.fill(area, with: .color(Theme.accent.opacity(0.10)))
            context.stroke(line, with: .color(Theme.accent), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            let maxIdx = temps.firstIndex(of: max) ?? 0, minIdx = temps.firstIndex(of: min) ?? 0
            context.draw(Text("\(Int(max.rounded()))\(unit)").font(Typeface.mono(11)).foregroundColor(Theme.ink2), at: CGPoint(x: x(maxIdx), y: y(max) - 10))
            context.draw(Text("\(Int(min.rounded()))\(unit)").font(Typeface.mono(11)).foregroundColor(Theme.ink3), at: CGPoint(x: x(minIdx), y: y(min) + 10))
            for i in [0, (hours.count - 1) / 2, hours.count - 1] {
                let anchor: UnitPoint = i == 0 ? .bottomLeading : i == hours.count - 1 ? .bottomTrailing : .bottom
                context.draw(Text(hours[i].time).font(Typeface.mono(10)).foregroundColor(Theme.ink4), at: CGPoint(x: x(i), y: size.height - 2), anchor: anchor)
            }
        }
        .accessibilityLabel("Temperature over the next \(hours.count) hours")
    }
}

/// A wrapping HStack for data-point chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 { x = 0; y += rowHeight + 6; rowHeight = 0 }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > bounds.width, x > 0 { x = 0; y += rowHeight + 6; rowHeight = 0 }
            sub.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// ─── Domain pulse ────────────────────────────────────────────────────────

struct DomainPulsePanel: View {
    var rows: [AgendaBundle.CadenceRow]
    var onWeb: (String) -> Void

    private static let order = ["slip": 0, "stale": 1, "ok": 2, "unconfigured": 3]

    var body: some View {
        let sorted = rows.sorted { (Self.order[$0.status] ?? 9, $0.name) < (Self.order[$1.status] ?? 9, $1.name) }
        PanelFrame(eyebrow: "Domain pulse · \(sorted.count)", action: ("All domains →", "/work"), onWeb: onWeb) {
            VStack(spacing: 0) {
                ForEach(sorted) { d in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        NavigationLink(value: DomainRoute.domain(d.id)) {
                            Text(d.name).font(Typeface.sans(14, .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                        }
                        .buttonStyle(.plain)
                        .frame(width: 112, alignment: .leading)
                        if let metric = d.metric {
                            let tone: Color = d.status == "slip" ? Theme.accent : d.status == "stale" ? Theme.warn : Theme.ink3
                            (Text("\(metric) ").font(Typeface.serif(19, .medium)) + Text(d.unit).font(Typeface.sans(12))
                             + Text(d.cadence != nil && d.status != "ok" ? " · cadence \(d.cadence!)" : "").font(Typeface.sans(12)).foregroundColor(Theme.ink4))
                                .foregroundStyle(tone).lineLimit(2)
                        } else {
                            Text("quiet — no cadence set").font(Typeface.sans(12)).italic().foregroundStyle(Theme.ink4)
                        }
                        Spacer(minLength: 4)
                        if let s = d.stats {
                            HStack(spacing: 8) {
                                Text("\(s.open_tasks) OPEN")
                                if s.overdue > 0 { Text("\(s.overdue) OVERDUE").foregroundStyle(Theme.accent) }
                            }
                            .font(Typeface.mono(10)).tracking(0.5).foregroundStyle(Theme.ink3)
                        }
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .top) { Hairline() }
                }
                Hairline()
            }
        }
    }
}

// ─── Silent clients / Attention ───────────────────────────────────────────

func silenceUrgency(_ days: Int?) -> Urgency {
    guard let days else { return .quiet }
    if days >= 30 { return .over }
    if days >= 14 { return .due }
    if days <= 3 { return .ok }
    return .quiet
}

func silenceLabel(_ days: Int?) -> String {
    guard let days else { return "No contact" }
    return days == 0 ? "Today" : "\(days)d"
}

struct SilentClientsPanel: View {
    @ObservedObject var model: AgendaModel
    var items: [AgendaBundle.AttentionItem]
    var onWeb: (String) -> Void

    var body: some View {
        PanelFrame(eyebrow: "Silent clients · \(items.count)", action: ("Companies →", "/companies"), onWeb: onWeb, gap: 8) {
            VStack(spacing: 0) {
                ForEach(items) { item in
                    let name = item.title.replacingOccurrences(of: "^Silent client:\\s*", with: "", options: .regularExpression)
                    let days = item.detail.flatMap { detail -> Int? in
                        guard let range = detail.range(of: "\\d+(?=\\s*day)", options: .regularExpression) else { return nil }
                        return Int(detail[range])
                    }
                    HStack(spacing: 12) {
                        Button { onWeb("/companies/\(item.source_id)") } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(name).font(Typeface.serif(15, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                                if let detail = item.detail { Text(detail).font(Typeface.mono(11)).foregroundStyle(Theme.ink3).lineLimit(1) }
                            }
                        }.buttonStyle(.plain)
                        Spacer(minLength: 4)
                        Pill(days == nil ? .over : silenceUrgency(days), label: silenceLabel(days))
                        SmallOutlineButton(label: "Log check-in") { model.logCheckIn(companyID: item.source_id) }
                    }
                    .padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Hairline() }
                }
            }
        }
    }
}

struct AttentionPanel: View {
    @ObservedObject var model: AgendaModel
    var attention: AgendaBundle.Attention
    var onWeb: (String) -> Void

    private func href(_ item: AgendaBundle.AttentionItem) -> String? {
        switch item.source_type {
        case "person": return "/people/\(item.source_id)"
        case "company": return "/companies/\(item.source_id)"
        case "domain": return "/domains/\(item.source_id)"
        case "project": return "/projects/\(item.source_id)"
        case "task": return "/tasks/\(item.source_id)"
        case "content": return "/content/\(item.source_id)"
        case "maintenance_item": return "/maintenance/\(item.source_id)"
        case "asset": return "/maintenance/assets/\(item.source_id)"
        default: return nil
        }
    }

    var body: some View {
        let eyebrow = "Attention" + (attention.active_count > 0 ? " · \(attention.active_count) active" : "")
        PanelFrame(eyebrow: eyebrow, action: attention.active_count > attention.items.count ? ("See all →", "/attention") : nil, onWeb: onWeb, gap: 8) {
            VStack(spacing: 0) {
                ForEach(attention.items) { item in
                    HStack(alignment: .top, spacing: 12) {
                        Circle().fill(item.urgency == "high" ? Theme.accent : item.urgency == "normal" ? Theme.ink2 : Theme.ink3)
                            .frame(width: 8, height: 8).padding(.top, 6)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title).font(Typeface.sans(14)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                            if let detail = item.detail { Text(detail).font(Typeface.sans(12)).foregroundStyle(Theme.ink3).lineLimit(2) }
                            HStack(spacing: 14) {
                                if let path = href(item) { PanelTextButton(label: "\(item.suggested_action ?? "Open") →") { onWeb(path) } }
                                PanelTextButton(label: "Done") { model.attention(item.id, action: "acted_on") }
                                PanelTextButton(label: "Snooze") { model.attention(item.id, action: "snooze") }
                                PanelTextButton(label: "Dismiss") { model.attention(item.id, action: "dismiss") }
                            }
                        }
                    }
                    .padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Hairline() }
                }
            }
        }
    }
}

// ─── Reflection / Latest quote ────────────────────────────────────────────

struct ReflectionPanel: View {
    @ObservedObject var model: AgendaModel
    var resurfacing: AgendaBundle.Resurfacing
    var onWeb: (String) -> Void

    var body: some View {
        if resurfacing.item != nil || resurfacing.exhausted == true {
            VStack(alignment: .leading, spacing: 12) {
                Eyebrow(text: "Reflection")
                if let item = resurfacing.item {
                    Text("“\(item.excerpt)”").font(Typeface.serif(19, .regular, italic: true)).foregroundStyle(Theme.ink).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                    if let source = item.source { Text("— \(source)".uppercased()).font(Typeface.mono(11)).tracking(0.8).foregroundStyle(Theme.ink3) }
                    HStack(spacing: 16) {
                        if let href = item.href { PanelTextButton(label: "Open in \(item.kind == "quote" ? "Quotes" : "Journal") →", tone: Theme.accent) { onWeb(href) } }
                        PanelTextButton(label: "Next →") { model.skipResurfacing(item.id) }
                        if !model.skipped.isEmpty { PanelTextButton(label: "Reset") { model.resetResurfacing() } }
                    }
                } else {
                    Text("You’ve seen every item in today’s rotation. Tomorrow’s pick will come from the same pool, fresh.")
                        .font(Typeface.serif(17, .regular, italic: true)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                    PanelTextButton(label: "Reset rotation now →", tone: Theme.accent) { model.resetResurfacing() }
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .overlay(alignment: .top) { Hairline() }
            .overlay(alignment: .bottom) { Hairline() }
        }
    }
}

struct LatestQuotePanel: View {
    var quote: AgendaBundle.Briefing.Quote
    var onWeb: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: "Latest quote")
            Text("“\(quote.text)”").font(Typeface.serif(17, .regular, italic: true)).foregroundStyle(Theme.ink).lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            let source = [quote.source_author, quote.source_reference].compactMap { $0 }.joined(separator: " · ")
            if !source.isEmpty { Text("— \(source)".uppercased()).font(Typeface.mono(11)).tracking(0.8).foregroundStyle(Theme.ink3) }
            HStack(spacing: 16) {
                PanelTextButton(label: "Open quote →", tone: Theme.accent) { onWeb(quote.href) }
                if let source = quote.source_url, let url = URL(string: source) {
                    PanelTextButton(label: "Open source ↗") { UIApplication.shared.open(url) }
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 0).stroke(Theme.line, lineWidth: 1))
        .padding(.horizontal, 20)
    }
}

// ─── Pinned ──────────────────────────────────────────────────────────────

struct PinnedPanel: View {
    @ObservedObject var model: AgendaModel
    var pins: [AgendaBundle.Pin]
    var onWeb: (String) -> Void

    private static let typeLabel = ["task": "Task", "project": "Project", "domain": "Domain", "person": "Person", "company": "Company",
                                    "content_item": "Content", "book": "Book", "note": "Note", "quote": "Quote", "routine": "Routine"]

    var body: some View {
        PanelFrame(eyebrow: "Pinned · \(pins.count)", gap: 4) {
            VStack(spacing: 0) {
                ForEach(Array(pins.enumerated()), id: \.element.id) { index, pin in
                    HStack(spacing: 12) {
                        if let task = pin.task {
                            Button { model.completeAgendaTask(pin.target_id) } label: {
                                RoundedRectangle(cornerRadius: 4).fill(task.status == "done" ? Theme.ink : .clear)
                                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(task.status == "done" ? Theme.ink : Theme.lineStrongest, lineWidth: 1.5))
                                    .overlay(task.status == "done" ? Icon(name: .check, size: 10, strokeWidth: 2, color: Theme.bg) : nil)
                                    .frame(width: 18, height: 18)
                            }.buttonStyle(.plain).disabled(task.status == "done")
                        } else if let routine = pin.routine {
                            Circle().fill(routine.done_today ? Theme.good : .clear).frame(width: 9, height: 9)
                                .overlay(Circle().stroke(routine.done_today ? .clear : Theme.lineStrongest, lineWidth: 1.5))
                        } else if let color = pin.project?.color.flatMap(Color.init(css:)) {
                            RoundedRectangle(cornerRadius: 2.5).fill(color).frame(width: 9, height: 9)
                        }
                        Button { openPin(pin) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(pin.title).font(Typeface.sans(14)).foregroundStyle(pin.task?.status == "done" ? Theme.ink3 : Theme.ink)
                                    .strikethrough(pin.task?.status == "done").lineLimit(1)
                                Text(((Self.typeLabel[pin.target_type] ?? pin.target_type) + (pin.subtitle.map { " · \($0)" } ?? "")).uppercased())
                                    .font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3).lineLimit(1)
                            }
                        }.buttonStyle(.plain)
                        Spacer(minLength: 4)
                        if let state = pin.state { Pill(state == "over" ? .over : .due, label: state == "over" ? "Overdue" : "Due today") }
                        if let company = pin.company, let days = company.silent_days { Pill(silenceUrgency(days), label: silenceLabel(days)) }
                        HStack(spacing: 2) {
                            PanelTextButton(label: "↑") { model.movePin(pin, up: true) }.disabled(index == 0).opacity(index == 0 ? 0.3 : 1)
                            PanelTextButton(label: "↓") { model.movePin(pin, up: false) }.disabled(index == pins.count - 1).opacity(index == pins.count - 1 ? 0.3 : 1)
                            PanelTextButton(label: "×") { model.unpin(pin) }
                        }
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .bottom) { Hairline() }
                }
            }
        }
    }

    private func openPin(_ pin: AgendaBundle.Pin) { onWeb(pin.href) }
}

// ─── Timeline ────────────────────────────────────────────────────────────

struct TimelinePanel: View {
    @ObservedObject var model: AgendaModel
    var agenda: AgendaBundle.Agenda
    var onWeb: (String) -> Void

    var body: some View {
        let events = agenda.all_day.count + agenda.timeline.filter { $0.kind == "event" }.count
        let tasks = agenda.timeline.filter { $0.kind == "task" }.count + agenda.untimed_tasks.count
        var eyebrow = "Today"
        let _ = { if events > 0 { eyebrow += " · \(events) \(events == 1 ? "event" : "events")" }; if tasks > 0 { eyebrow += " · \(tasks) \(tasks == 1 ? "task" : "tasks")" } }()
        PanelFrame(eyebrow: eyebrow, action: ("Open →", "/calendar"), onWeb: onWeb) {
            if events == 0 && tasks == 0 {
                Text("No events or dated tasks today.").font(Typeface.sans(13)).italic().foregroundStyle(Theme.ink3)
            } else {
                VStack(spacing: 0) {
                    ForEach(agenda.all_day) { e in
                        row(label: "ALL DAY", labelTone: Theme.ink3) {
                            Text(e.title).font(Typeface.sans(13)).foregroundStyle(Theme.ink2).lineLimit(1)
                        }.onTapGesture { onWeb("/calendar") }
                    }
                    ForEach(Array(agenda.timeline.enumerated()), id: \.offset) { _, entry in
                        if entry.kind == "event" {
                            row(label: entry.time_label, labelTone: Theme.ink) {
                                (Text(entry.title ?? "") + Text(entry.location.map { " · \($0)" } ?? "").foregroundColor(Theme.ink3))
                                    .font(Typeface.sans(13)).foregroundStyle(Theme.ink2).lineLimit(1)
                            }.onTapGesture { onWeb("/calendar") }
                        } else if let task = entry.task {
                            taskRow(task, time: entry.time_label)
                        }
                    }
                    if !agenda.untimed_tasks.isEmpty {
                        Text("ANYTIME TODAY").font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8).padding(.bottom, 2)
                        ForEach(agenda.untimed_tasks) { task in taskRow(task, time: nil) }
                    }
                }
            }
        }
    }

    private func row<Content: View>(label: String, labelTone: Color, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(label).font(Typeface.mono(label == "ALL DAY" ? 10 : 12)).tracking(label == "ALL DAY" ? 0.8 : 0).foregroundStyle(labelTone).frame(width: 48, alignment: .leading)
            content()
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Hairline() }
        .contentShape(Rectangle())
    }

    private func taskRow(_ task: AgendaBundle.Agenda.Task, time: String?) -> some View {
        HStack(alignment: .center, spacing: 10) {
            if let time { Text(time).font(Typeface.mono(12)).foregroundStyle(Theme.ink3).frame(width: 48, alignment: .leading) }
            Button { model.completeAgendaTask(task.id) } label: {
                RoundedRectangle(cornerRadius: 3).stroke(Theme.lineStrongest, lineWidth: 1.5).frame(width: 15, height: 15)
            }.buttonStyle(.plain).accessibilityLabel("Complete task")
            NavigationLink(value: DomainRoute.task(task.id)) {
                (Text(task.title) + Text(task.project.map { " · \($0.name)" } ?? "").foregroundColor(Theme.ink3))
                    .font(Typeface.sans(13)).foregroundStyle(Theme.ink).lineLimit(1)
            }.buttonStyle(.plain)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Hairline() }
    }
}

// ─── Doing ───────────────────────────────────────────────────────────────

struct DoingPanel: View {
    @ObservedObject var model: AgendaModel
    @ObservedObject var offline: OfflineModel
    var bundle: AgendaBundle
    var onWeb: (String) -> Void

    var body: some View {
        let briefing = bundle.briefing
        let triage = briefing?.inbox_triage_count ?? 0
        let rail = bundle.rail
        if !(rail.tasks.isEmpty && (briefing?.doing_today.open_count ?? 0) == 0 && triage == 0) {
            var eyebrow = "Doing"
            let _ = { if let b = briefing { eyebrow += " · \(b.doing_today.open_count) open"; if b.doing_today.overdue_count > 0 { eyebrow += " · \(b.doing_today.overdue_count) overdue" } } }()
            PanelFrame(eyebrow: eyebrow, action: ("All tasks →", "/tasks"), onWeb: onWeb, gap: 4) {
                VStack(alignment: .leading, spacing: 0) {
                    if triage > 0 {
                        Button { onWeb("/inbox") } label: {
                            HStack {
                                (Text("Inbox · ") + Text("\(triage)").fontWeight(.semibold) + Text(triage == 1 ? " needs a home" : " need a home"))
                                    .font(Typeface.sans(13)).foregroundStyle(Theme.ink)
                                Spacer()
                                Text("TRIAGE →").font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.accent)
                            }
                            .padding(.leading, 10).padding(.trailing, 8).padding(.vertical, 6)
                            .background(Theme.accentBg)
                            .overlay(alignment: .leading) { Rectangle().fill(Theme.accent).frame(width: 2) }
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                        }.buttonStyle(.plain).padding(.bottom, 6)
                    }
                    if rail.tasks.isEmpty {
                        Text("Nothing overdue. Star any task to pin it here as Top 3; today’s dated tasks live on the Timeline.")
                            .font(Typeface.sans(13)).italic().foregroundStyle(Theme.ink3).padding(.vertical, 8).fixedSize(horizontal: false, vertical: true)
                    } else {
                        ForEach(rail.tasks) { task in
                            HStack(alignment: .top, spacing: 0) {
                                AgendaTaskRow(model: model, offline: offline, task: task, today: bundle.today)
                                NavigationLink(value: DomainRoute.task(task.id)) {
                                    Icon(name: .chev, size: 14, color: Theme.ink4).frame(width: 28, height: 32)
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                    if rail.top3_count < 3, !rail.tasks.isEmpty {
                        Text("\(3 - rail.top3_count) TOP 3 \(3 - rail.top3_count == 1 ? "SLOT" : "SLOTS") OPEN · TAP ☆ ON A ROW TO PIN")
                            .font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3).padding(.top, 8)
                    }
                    if rail.overflow > 0 { PanelTextButton(label: "+ \(rail.overflow) more →") { onWeb("/tasks") } }
                }
            }
        }
    }
}

/// TaskRow with the Top 3 star wired to the Agenda's own toggle.
struct AgendaTaskRow: View {
    @ObservedObject var model: AgendaModel
    @ObservedObject var offline: OfflineModel
    var task: OfflineTask
    var today: String

    var body: some View {
        let due = task.due_date.flatMap { DueLabel.format($0, today: today) }
        let starred = task.top3_for_date == today
        HStack(alignment: .top, spacing: 12) {
            Button { model.toggleDone(task) } label: {
                RoundedRectangle(cornerRadius: 0).stroke(Theme.lineStrong, lineWidth: 1).frame(width: 20, height: 20).padding(.top, 2).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Mark task done")
            VStack(alignment: .leading, spacing: 3) {
                Text(task.title).font(Typeface.sans(14)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 12) {
                    if let parent = task.parent_task { Text("↳ \(parent.title)").font(Typeface.sans(11)).foregroundStyle(Theme.ink3).lineLimit(1) }
                    if let project = task.project {
                        HStack(spacing: 6) {
                            if let color = project.color.flatMap(Color.init(css:)) { Circle().fill(color).frame(width: 8, height: 8) }
                            Text(project.name.uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3).lineLimit(1)
                        }
                    }
                    if let due {
                        Text(due.text.uppercased()).font(Typeface.mono(10)).tracking(0.8)
                            .foregroundStyle(due.kind == .overdue ? Theme.accent : due.kind == .today ? Theme.ink2 : Theme.ink3)
                    }
                }
            }
            Spacer(minLength: 0)
            Button { model.toggleTop3(task) } label: {
                Text(starred ? "★" : "☆").font(.system(size: 16)).foregroundStyle(starred ? Theme.accent : Theme.ink3).padding(.top, 2)
            }.buttonStyle(.plain).accessibilityLabel(starred ? "Remove from Top 3" : "Add to Top 3")
        }
        .padding(.vertical, 8)
    }
}

// ─── Health / Routines ───────────────────────────────────────────────────

struct HealthPanel: View {
    var health: AgendaBundle.Health
    var onWeb: (String) -> Void
    private static let labels = ["weight": "Weight", "bp": "BP", "hr_resting": "Resting HR", "hrv": "HRV", "spo2": "SpO₂", "sleep_duration": "Sleep", "sleep_score": "Sleep score"]

    var body: some View {
        let vitals = health.latest_vitals.filter { Self.labels[$0.metric] != nil && $0.value != nil }.prefix(4)
        let visit = health.upcoming_visits.first
        let flagged = health.recent_labs.flatMap { panel in panel.results.filter { $0.flag != nil }.map { (panel, $0) } }.prefix(3)
        if !(vitals.isEmpty && visit == nil && flagged.isEmpty && health.active_medications.isEmpty) {
            PanelFrame(eyebrow: "Health", action: ("Open →", "/health"), onWeb: onWeb) {
                VStack(alignment: .leading, spacing: 0) {
                    if !vitals.isEmpty {
                        FlowLayout(spacing: 16) {
                            ForEach(Array(vitals)) { v in
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Text((Self.labels[v.metric] ?? v.metric).uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3)
                                    Text(value(v)).font(Typeface.mono(12)).foregroundStyle(Theme.ink)
                                }
                            }
                        }
                        .padding(.bottom, 8).overlay(alignment: .bottom) { Hairline() }
                    }
                    if let visit {
                        HStack(alignment: .firstTextBaseline, spacing: 16) {
                            Text(visit.visit_date).font(Typeface.mono(11)).foregroundStyle(Theme.ink3)
                            (Text(visit.provider_name ?? "Visit") + Text(visit.reason.map { " · \($0)" } ?? "").foregroundColor(Theme.ink3))
                                .font(Typeface.sans(13)).foregroundStyle(Theme.ink2).lineLimit(1)
                        }
                        .padding(.vertical, 6).overlay(alignment: .bottom) { Hairline() }
                        .onTapGesture { onWeb("/health/visits/\(visit.id)") }
                    }
                    ForEach(Array(flagged.enumerated()), id: \.offset) { _, pair in
                        HStack(alignment: .firstTextBaseline, spacing: 16) {
                            Text((pair.1.flag ?? "").uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.warn)
                            Text("\(pair.1.analyte) · \(pair.0.panel_name)").font(Typeface.sans(13)).foregroundStyle(Theme.ink2).lineLimit(1)
                        }
                        .padding(.vertical, 6).overlay(alignment: .bottom) { Hairline() }
                        .onTapGesture { onWeb("/health/labs/\(pair.0.id)") }
                    }
                    if !health.active_medications.isEmpty {
                        let n = health.active_medications.count
                        PanelTextButton(label: "\(n) active \(n == 1 ? "medication" : "medications") →") { onWeb("/health/meds") }.padding(.top, 8)
                    }
                }
            }
        }
    }

    private func value(_ v: AgendaBundle.Health.Vital) -> String {
        func f(_ d: Double) -> String { d.rounded() == d ? String(Int(d)) : String(format: "%.1f", d) }
        guard let value = v.value else { return "" }
        let unit = v.unit.map { " \($0)" } ?? ""
        if let secondary = v.value_secondary { return "\(f(value))/\(f(secondary))\(unit)" }
        return "\(f(value))\(unit)"
    }
}

struct RoutinesPanel: View {
    @ObservedObject var model: AgendaModel
    var bundle: AgendaBundle
    var onWeb: (String) -> Void
    private static let buckets: [(String, String)] = [("morning", "Morning"), ("afternoon", "Afternoon"), ("evening", "Evening"), ("anytime", "Anytime")]

    var body: some View {
        PanelFrame(eyebrow: "Routines · \(bundle.counts.routines_done) of \(bundle.counts.routines_total) today", action: ("All →", "/routines"), onWeb: onWeb) {
            if bundle.routines.isEmpty {
                PanelTextButton(label: bundle.routines_failed == true ? "Couldn’t load routines — open /routines to check." : "No active routines. Add one →") { onWeb("/routines") }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Self.buckets, id: \.0) { key, label in
                        let list = bundle.routines.filter { ($0.time_of_day ?? "anytime") == key }.sorted(by: Self.sort)
                        if !list.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(label.uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3)
                                ForEach(list) { routine in row(routine) }
                            }
                        }
                    }
                }
            }
        }
    }

    private static func sort(_ a: AgendaBundle.Routine, _ b: AgendaBundle.Routine) -> Bool {
        switch (a.specific_time, b.specific_time) {
        case let (x?, y?): return x < y
        case (_?, nil): return true
        case (nil, _?): return false
        default: return (a.position ?? 0) < (b.position ?? 0)
        }
    }

    private func row(_ routine: AgendaBundle.Routine) -> some View {
        let done = routine.stats.done_today
        let missed = !done && routine.last_missed_sent_date == bundle.today
        return Button { model.toggleRoutine(routine) } label: {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 4).fill(done ? Theme.ink : .clear)
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(done ? Theme.ink : Theme.lineStrongest, lineWidth: 1.5))
                    .overlay(done ? Icon(name: .check, size: 10, strokeWidth: 2, color: Theme.bg) : nil)
                    .frame(width: 18, height: 18)
                Text(routine.name).font(Typeface.sans(14)).foregroundStyle(done ? Theme.ink3 : Theme.ink).strikethrough(done)
                if let time = Self.formatTime(routine.specific_time) { Text(time).font(Typeface.mono(10)).foregroundStyle(Theme.ink3) }
                if missed { Pill(.over, label: "Missed", dot: false) }
                Spacer()
                if let streak = routine.stats.current_streak, streak > 1 { Text("\(streak)d").font(Typeface.mono(10)).foregroundStyle(Theme.ink4) }
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private static func formatTime(_ t: String?) -> String? {
        guard let t, t.count >= 5, let h = Int(t.prefix(2)) else { return nil }
        let minutes = t.dropFirst(3).prefix(2)
        let display = h == 0 ? 12 : h <= 12 ? h : h - 12
        return "\(display):\(minutes) \(h < 12 ? "AM" : "PM")"
    }
}
