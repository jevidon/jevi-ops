import SwiftUI

/// The Domains tab — the web's Work page (issue #79 redesign): masthead,
/// filter, then compact domain cards in one column, each collapsed until
/// opened. Everything shown is the server-derived Work payload from the last
/// sync; expansion state lives only for the visit.
struct DomainsView: View {
    @ObservedObject var model: OfflineModel
    var onCompose: (ComposeContext) -> Void
    var onWeb: (String) -> Void
    @State private var expanded: Set<String> = []
    @State private var showParked = false
    @State private var query = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    masthead
                    EditorialField(placeholder: "Find domains, assets, projects, content…", text: $query)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 16)
                    if let message = model.connectionMessage { Notice(text: message) }
                    if let error = model.storageError { Notice(text: error, tone: .error) }
                    if let work = model.work {
                        let active = work.domains.filter(matches)
                        let parked = work.parked.filter(matches)
                        if !active.isEmpty { board(active) }
                        if active.isEmpty {
                            Text(query.trimmingCharacters(in: .whitespaces).isEmpty ? "No active domains."
                                 : parked.isEmpty ? "No domains match. Try another search or clear it." : "Matching domains are in Parked below.")
                                .font(Typeface.sans(14)).foregroundStyle(Theme.ink3)
                                .padding(.horizontal, 20).padding(.vertical, 32)
                        }
                        if !work.parked.isEmpty {
                            TextAction(label: "\(showParked ? "▾" : "▸")  Parked (\(parked.count))") { showParked.toggle() }
                                .padding(.horizontal, 12).padding(.top, 24)
                            if showParked {
                                if parked.isEmpty { Notice(text: "No parked domains match.") }
                                else { board(parked).opacity(0.7) }
                            }
                        }
                        if let fetched = model.snapshot?.fetchedAt {
                            Text("Last downloaded \(fetched.formatted(date: .abbreviated, time: .shortened))")
                                .font(Typeface.mono(10)).foregroundStyle(Theme.ink4)
                                .padding(.horizontal, 20).padding(.top, 28)
                        }
                    } else {
                        notDownloaded
                    }
                }
                .padding(.bottom, 40)
            }
            .background(Theme.bg)
            .refreshable { await model.refresh() }
            .navigationDestination(for: DomainRoute.self) { route in
                switch route {
                case .domain(let id): DomainDetailView(model: model, domainID: id, onCompose: onCompose, onWeb: onWeb)
                case .project(let id): ProjectDetailView(model: model, projectID: id, onCompose: onCompose, onWeb: onWeb)
                case .task(let id): TaskDetailView(model: model, taskID: id, onWeb: onWeb)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .task { await model.refresh() }
    }

    private var masthead: some View {
        HStack(alignment: .bottom) {
            Text("Domains").font(Typeface.serif(40, .medium)).tracking(-0.9).foregroundStyle(Theme.ink)
            Spacer()
            HStack(spacing: 8) {
                ActionButton(label: "Ideas (\(model.work?.ideasCount ?? 0))", variant: .ghost) { onWeb("/content?status=idea") }
                ActionButton(label: "+ Domain", variant: .solid) { onWeb("/domains/new") }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .padding(.bottom, 16)
    }

    private var notDownloaded: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.snapshot == nil && !model.isLinked
                 ? "Link this phone to your server, then sync once while connected to bring the Domains board here."
                 : "Sync once while connected to download the Domains board. It stays readable offline afterwards.")
                .font(Typeface.sans(14)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            ActionButton(label: model.refreshing ? "Syncing…" : "Sync now", variant: .solid) { Task { await model.refresh() } }
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private func matches(_ d: WorkDomain) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return true }
        func hit(_ s: String?) -> Bool { s?.localizedCaseInsensitiveContains(q) ?? false }
        return hit(d.name) || d.assets.contains { hit($0.name) } || d.projects.contains { hit($0.name) || hit($0.client) || hit($0.asset?.name) }
            || d.content.contains { hit($0.title) }
    }

    private func board(_ list: [WorkDomain]) -> some View {
        VStack(spacing: 0) {
            Rectangle().fill(Theme.ink).frame(height: 2)
            ForEach(list) { domain in
                DomainCard(domain: domain, art: model.snapshot?.domain(domain.id)?.illustration?.svg,
                           expanded: expanded.contains(domain.id), onToggle: { toggle(domain.id) },
                           onCompose: onCompose, onWeb: onWeb, domainRef: model.snapshot?.domain(domain.id))
            }
        }
        .padding(.horizontal, 20)
    }

    private func toggle(_ id: String) {
        withAnimation(.easeOut(duration: 0.15)) {
            if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
        }
    }
}

enum DomainRoute: Hashable {
    case domain(String), project(String), task(String)
}

/// One compact domain card: engraving + urgency pill on the left, serif name
/// (links to the domain page) and counts; tapping anywhere else toggles the
/// contents in place.
struct DomainCard: View {
    var domain: WorkDomain
    var art: String?
    var expanded: Bool
    var onToggle: () -> Void
    var onCompose: (ComposeContext) -> Void
    var onWeb: (String) -> Void
    var domainRef: OfflineDomain?

    private var color: Color { Theme.domainColor(domain.name) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .trailing, spacing: 6) {
                    FittedArt(name: domain.name, svg: art, color: color, align: "xMaxYMid")
                        .frame(width: 84, height: 34)
                    Pill(domain.urgency, fill: true)
                }
                .frame(width: 84)
                VStack(alignment: .leading, spacing: 6) {
                    NavigationLink(value: DomainRoute.domain(domain.id)) {
                        Text(domain.name)
                            .font(Typeface.serif(21, .medium)).tracking(-0.3)
                            .foregroundStyle(Theme.ink)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .buttonStyle(.plain)
                    HStack(spacing: 10) {
                        Text("\(domain.rollup.open) open")
                        if domain.rollup.overdue > 0 { Text("\(domain.rollup.overdue) overdue").foregroundStyle(Theme.accent) }
                        if domain.rollup.waiting > 0 { Text("\(domain.rollup.waiting) waiting") }
                    }
                    .font(Typeface.mono(11, .medium)).foregroundStyle(Theme.ink3)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 8)
            .frame(minHeight: 80)
            .background(expanded ? Theme.surface : .clear, in: RoundedRectangle(cornerRadius: 4))
            .padding(.horizontal, -8)
            .contentShape(Rectangle())
            .onTapGesture(perform: onToggle)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("domainCard-\(domain.name)")

            if expanded { contents }
        }
        .overlay(alignment: .bottom) { Hairline(strong: true) }
    }

    private var contents: some View {
        VStack(alignment: .leading, spacing: 0) {
            Hairline()
            HStack {
                NavigationLink(value: DomainRoute.domain(domain.id)) {
                    HStack(spacing: 8) { Text("Open domain").underline(); Text("→") }
                        .font(Typeface.mono(11)).foregroundStyle(Theme.ink2).frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open domain: \(domain.name)")
                Spacer()
                Text("\(plural(domain.assets.count, "asset")) · \(plural(domain.projects.count, "project")) · \(domain.content.count) content")
                    .font(Typeface.mono(10.5)).foregroundStyle(Theme.ink3)
            }
            if !domain.assets.isEmpty {
                sectionLabel("Assets")
                ForEach(domain.assets) { asset in
                    AssetCardView(asset: asset, color: color).padding(.bottom, 12).onTapGesture { onWeb("/assets/\(asset.id)") }
                }
            }
            if !domain.projects.isEmpty {
                sectionLabel("Projects")
                ForEach(domain.projects) { project in
                    NavigationLink(value: DomainRoute.project(project.id)) { ProjectCardView(project: project, color: color) }
                        .buttonStyle(.plain).padding(.bottom, 12)
                }
            }
            if !domain.content.isEmpty {
                sectionLabel("Content")
                VStack(spacing: 0) {
                    ForEach(Array(domain.content.enumerated()), id: \.element.id) { index, row in
                        ContentRowView(row: row, color: color).onTapGesture { onWeb("/content/\(row.id)") }
                        if index < domain.content.count - 1 { Hairline() }
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.line, lineWidth: 1))
                .padding(.bottom, 16)
            }
            if domain.isEmpty { EmptyNote(text: "Nothing open.") }
            HStack(spacing: 4) {
                if domain.direct.open > 0 || domain.direct.waiting > 0 {
                    NavigationLink(value: DomainRoute.domain(domain.id)) {
                        Text(directLabel).font(Typeface.mono(11)).foregroundStyle(Theme.ink2).frame(minHeight: 44).padding(.horizontal, 8)
                    }
                    .buttonStyle(.plain)
                }
                TextAction(label: "+ Project") { onWeb("/projects/new?domain_id=\(domain.id)") }
                TextAction(label: "+ Task") { onCompose(ComposeContext(domain: Domain(id: domain.id, name: domain.name))) }
            }
            .padding(.bottom, 12)
        }
    }

    private var directLabel: String {
        var s = "Direct tasks \(domain.direct.open)"
        if domain.direct.overdue > 0 { s += " · \(domain.direct.overdue) overdue" }
        if domain.direct.waiting > 0 { s += " · \(domain.direct.waiting) waiting" }
        return s
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title.uppercased()).font(Typeface.mono(11)).tracking(0.8).foregroundStyle(Theme.ink3)
            .padding(.top, 8).padding(.bottom, 12)
    }

    private func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }
}

struct ProjectCardView: View {
    var project: WorkProjectCard
    var color: Color

    var body: some View {
        CardShell(color: color, flagged: project.flagged, dimmed: project.paused) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        if project.flagged { Circle().fill(Theme.accent).frame(width: 6, height: 6) }
                        Text(project.name).font(Typeface.serif(16.5, .medium)).tracking(-0.15).foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 4)
                    Pill(project.urgency)
                }
                .padding(.bottom, 8)
                Text(project.metaLine.uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3).lineLimit(1)
                    .padding(.bottom, 11)
                if let pct = project.progress {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.surface2)
                            Capsule().fill(project.kind == "target" ? Theme.ink2 : Theme.ink4)
                                .frame(width: max(0, geo.size.width * CGFloat(min(100, pct)) / 100))
                        }
                    }
                    .frame(height: 4)
                }
                HStack {
                    (Text("\(project.open) open") + Text(project.waiting > 0 ? " · \(project.waiting) waiting" : "")
                     + Text(project.overdue > 0 ? " · \(project.overdue) overdue" : "").foregroundColor(Theme.accent))
                        .font(Typeface.mono(11)).foregroundStyle(Theme.ink3)
                    Spacer()
                    Text(project.recency).font(Typeface.mono(10.5)).foregroundStyle(Theme.ink4)
                }
                .padding(.top, 10)
                if project.waiting > 0, let who = project.waitOn {
                    (Text("waiting on \(who) ") + Text("\(project.waitDays ?? 0)d").foregroundColor(ageColor(project.waitDays)))
                        .font(Typeface.mono(10)).foregroundStyle(Theme.ink3).padding(.top, 4)
                }
            }
        }
    }
}

struct AssetCardView: View {
    var asset: WorkAssetCard
    var color: Color

    var body: some View {
        CardShell(color: color, flagged: asset.flagged) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 4).fill(Theme.surface2).frame(width: 40, height: 40)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.line, lineWidth: 1))
                        .overlay(Icon(name: .maintenance, size: 18, color: Theme.ink3))
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        if asset.flagged { Circle().fill(Theme.accent).frame(width: 6, height: 6) }
                        Text(asset.name).font(Typeface.serif(16.5, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    Pill(asset.urgency, label: asset.worst == "due_soon" ? "Due soon" : nil)
                }
                .padding(.bottom, 8)
                Text(([asset.kind] + [asset.meter].compactMap { $0 } + [asset.latest_reading_days_ago].compactMap { $0 }.filter { $0 > 0 }.map { "\($0)d ago" })
                    .joined(separator: " · ").uppercased())
                    .font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3).lineLimit(1).padding(.bottom, 11)
                HStack {
                    let m = asset.maintenance
                    (Text(m.overdue + m.due > 0 ? "\(m.overdue + m.due) due · " : "").foregroundColor(Theme.accent)
                     + Text(m.due_soon > 0 ? "\(m.due_soon) soon · " : "") + Text("\(m.total) item\(m.total == 1 ? "" : "s")"))
                        .font(Typeface.mono(11)).foregroundStyle(Theme.ink3)
                    Spacer()
                    Text("\(asset.projects) project\(asset.projects == 1 ? "" : "s")").font(Typeface.mono(10.5)).foregroundStyle(Theme.ink4)
                }
                if let note = asset.dataNote { Text(note).font(Typeface.mono(10)).foregroundStyle(Theme.ink3).padding(.top, 4) }
            }
        }
    }
}

struct ContentRowView: View {
    var row: WorkContentRow
    var color: Color

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2.5).fill(color).frame(width: 9, height: 9)
                .overlay(RoundedRectangle(cornerRadius: 2.5).stroke(row.flagged ? Theme.accent : .clear, lineWidth: 1).padding(-2))
            VStack(alignment: .leading, spacing: 4) {
                Text(row.title).font(Typeface.sans(14.5)).foregroundStyle(Theme.ink).lineLimit(1)
                HStack(spacing: 0) {
                    Text((CONTENT_TYPE_LABEL[row.type] ?? row.type).uppercased())
                    if row.holder == "editor" {
                        Text(" · WITH EDITOR ") + Text("\(row.days ?? 0)D").foregroundColor(ageColor(row.days))
                    } else if let move = row.move {
                        Text(" · \(move.uppercased())").foregroundColor(Theme.ink2)
                    }
                }
                .font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 4)
            Pill(row.urgency)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

/// Aging colour for day counts (cards.tsx ageClass): ≥7 accent, ≥3 ink-2.
func ageColor(_ days: Int?) -> Color {
    guard let days else { return Theme.ink3 }
    if days >= 7 { return Theme.accent }
    if days >= 3 { return Theme.ink2 }
    return Theme.ink3
}

/// Header art fitted to its ink (cards.tsx FittedArt): the drawing's own
/// bounds, padded 2.5 units, replace the canvas' arbitrary margins so every
/// motif hugs its slot. The name-seeded procedural drawing is the web's
/// fallback; the phone shows the domain colour cap until a committed
/// engraving has been synced, so the two never disagree.
struct FittedArt: View {
    var name: String
    var svg: String?
    var color: Color
    var align: String = "xMinYMax"

    var body: some View {
        if let svg, !svg.trimmingCharacters(in: .whitespaces).isEmpty {
            let doc = SVGParser.parse(svg)
            let box = doc.inkBounds.flatMap { b -> CGRect? in
                b.width > 4 && b.height > 4 ? b.insetBy(dx: -2.5, dy: -2.5) : nil
            } ?? CGRect(x: 0, y: 14, width: 240, height: 72)
            SVGArt(document: doc, viewBox: box, color: color, faint: color.opacity(0.48), align: align)
        } else {
            ProceduralMark(name: name, color: color, align: align)
        }
    }
}

/// A quiet stand-in when no engraving is stored: the domain's initial in the
/// domain colour on a hairline plinth, right-aligned like the engravings.
struct ProceduralMark: View {
    var name: String
    var color: Color
    var align: String

    var body: some View {
        HStack {
            if align.contains("xMax") { Spacer() }
            VStack(spacing: 3) {
                Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                    .font(Typeface.serif(26, .regular)).foregroundStyle(color)
                Rectangle().fill(color.opacity(0.48)).frame(width: 28, height: 1)
            }
            if align.contains("xMin") { Spacer() }
        }
    }
}
