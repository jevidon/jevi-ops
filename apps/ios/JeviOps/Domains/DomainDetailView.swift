import SwiftUI

/// /domains/[id] — the domain page's read surface (Detail Pages v2): header
/// band with the engraving, computed stat strip, direct tasks, projects,
/// assets and content. Editing, cadence and the illustration panel stay on
/// the web, one tap away.
struct DomainDetailView: View {
    @ObservedObject var model: OfflineModel
    var domainID: String
    var onCompose: (ComposeContext) -> Void
    var onWeb: (String) -> Void
    @State private var showDone = false

    private var work: WorkDomain? { model.work?.domain(domainID) }
    private var domain: OfflineDomain? { model.snapshot?.domain(domainID) }
    private var name: String { work?.name ?? domain?.name ?? "Domain" }
    private var color: Color { Theme.domainColor(name) }

    var body: some View {
        let direct = model.tasks(inDomain: domainID, directOnly: true)
        let open = direct.filter { !$0.isDone }
        let done = direct.filter(\.isDone)
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                DetailHeader(crumb: ["Domains", name], name: name, color: color, state: work?.urgency) {
                    ActionButton(label: "+ Task", variant: .ghost) { onCompose(ComposeContext(domain: Domain(id: domainID, name: name))) }
                    ActionButton(label: "Open on web", variant: .solid, icon: .arrow) { onWeb("/domains/\(domainID)") }
                }
                if let art = domain?.illustration?.svg {
                    FittedArt(name: name, svg: art, color: Theme.ink3, align: "xMinYMax")
                        .frame(height: 64).padding(.horizontal, 20).padding(.top, 16).opacity(0.8)
                }
                if let w = work {
                    StatStrip(tiles: [
                        StatTile(label: "Open", value: String(w.rollup.open), sub: "across projects and direct"),
                        StatTile(label: "Overdue", value: String(w.rollup.overdue), tone: w.rollup.overdue > 0 ? .accent : .neutral),
                        StatTile(label: "Waiting", value: String(w.rollup.waiting), sub: w.direct.waitingAging > 0 ? "\(w.direct.waitingAging) blocked a week+" : nil,
                                 tone: w.direct.waitingAging > 0 ? .warn : .neutral),
                        StatTile(label: "Due today", value: String(w.direct.today), sub: "direct tasks"),
                    ])
                }
                if let description = domain?.description, !description.isEmpty {
                    Text(description).font(Typeface.serif(16, .regular, italic: true)).foregroundStyle(Theme.ink2)
                        .padding(.horizontal, 20).padding(.top, 20).fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: 0) {
                    SectionEyebrow(title: "Direct tasks", count: open.count)
                    if open.isEmpty { EmptyNote(text: "No direct tasks. Everything here lives in a project.") }
                    ForEach(open) { task in TaskRowLink(model: model, task: task) }
                    if !done.isEmpty {
                        TextAction(label: "\(showDone ? "▾" : "▸")  Completed recently (\(done.count))") { showDone.toggle() }
                            .padding(.leading, -8)
                        if showDone { ForEach(done) { task in TaskRowLink(model: model, task: task) } }
                    }
                    if let w = work {
                        if !w.projects.isEmpty {
                            SectionEyebrow(title: "Projects", count: w.projects.count).padding(.bottom, 8)
                            ForEach(w.projects) { project in
                                NavigationLink(value: DomainRoute.project(project.id)) { ProjectCardView(project: project, color: color) }
                                    .buttonStyle(.plain).padding(.bottom, 12)
                            }
                        }
                        if !w.assets.isEmpty {
                            SectionEyebrow(title: "Assets", count: w.assets.count).padding(.bottom, 8)
                            ForEach(w.assets) { asset in
                                AssetCardView(asset: asset, color: color).padding(.bottom, 12).onTapGesture { onWeb("/assets/\(asset.id)") }
                            }
                        }
                        if !w.content.isEmpty {
                            SectionEyebrow(title: "Content", count: w.content.count).padding(.bottom, 8)
                            VStack(spacing: 0) {
                                ForEach(Array(w.content.enumerated()), id: \.element.id) { index, row in
                                    ContentRowView(row: row, color: color).onTapGesture { onWeb("/content/\(row.id)") }
                                    if index < w.content.count - 1 { Hairline() }
                                }
                            }
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.line, lineWidth: 1))
                        }
                    }
                    if let doc = domain?.doc_md, !doc.isEmpty {
                        SectionEyebrow(title: "Overview")
                        Text(doc).font(Typeface.sans(14)).foregroundStyle(Theme.ink2).lineSpacing(3)
                            .padding(.top, 12).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .background(Theme.bg)
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.surface, for: .navigationBar)
    }
}

/// /projects/[id] — the project's read surface: header, stat strip (target or
/// retainer cycle, progress, counts), tasks; milestones, checklist and the
/// activity log remain on the web.
struct ProjectDetailView: View {
    @ObservedObject var model: OfflineModel
    var projectID: String
    var onCompose: (ComposeContext) -> Void
    var onWeb: (String) -> Void
    @State private var showDone = false

    private var found: (domain: WorkDomain, project: WorkProjectCard)? { model.work?.project(projectID) }
    private var record: OfflineProject? { model.snapshot?.project(projectID) }
    private var name: String { found?.project.name ?? record?.name ?? "Project" }
    private var domainName: String { found?.domain.name ?? model.snapshot?.domain(record?.domain_id)?.name ?? "Domains" }

    var body: some View {
        let tasks = model.tasks(inProject: projectID)
        let open = tasks.filter { !$0.isDone }
        let done = tasks.filter(\.isDone)
        let color = record?.color.flatMap(Color.init(css:)) ?? Theme.domainColor(domainName)
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                DetailHeader(crumb: [domainName, record?.kind == "area" ? "Area" : "Project"], name: name, color: color,
                             state: found?.project.urgency, stateLabel: found?.project.paused == true ? "Paused" : nil) {
                    ActionButton(label: "+ Task", variant: .ghost) {
                        onCompose(ComposeContext(project: Project(id: projectID, name: name, status: record?.status ?? "active", color: record?.color,
                                                                  domain: record?.domain_id.map { Project.DomainRef(id: $0, name: domainName) })))
                    }
                    ActionButton(label: "Open on web", variant: .solid, icon: .arrow) { onWeb("/projects/\(projectID)") }
                }
                if let p = found?.project {
                    StatStrip(tiles: [
                        p.kind == "retainer"
                            ? StatTile(label: "Cycle", value: p.cycle.map { "\($0.day)/\($0.length)" } ?? "—", sub: "day of retainer cycle")
                            : StatTile(label: "Target", value: p.target.map { String($0.dropFirst(5)) } ?? "—", sub: p.target),
                        StatTile(label: "Progress", value: p.progress.map { "\(Int($0))" } ?? "—", unit: p.progress == nil ? nil : "%",
                                 sub: p.kind == "target" ? "milestone-weighted" : "of cycle"),
                        StatTile(label: "Open", value: String(p.open), sub: p.overdue > 0 ? "\(p.overdue) overdue" : p.recency,
                                 tone: p.overdue > 0 ? .accent : .neutral),
                        StatTile(label: "Waiting", value: String(p.waiting), sub: p.waitOn.map { "on \($0) · \(p.waitDays ?? 0)d" },
                                 tone: (p.waitDays ?? 0) >= 7 ? .warn : .neutral),
                    ])
                }
                if let description = record?.description, !description.isEmpty {
                    Text(description).font(Typeface.serif(16, .regular, italic: true)).foregroundStyle(Theme.ink2)
                        .padding(.horizontal, 20).padding(.top, 20).fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: 0) {
                    SectionEyebrow(title: "Tasks", count: open.count)
                    if open.isEmpty { EmptyNote(text: "Nothing open here.") }
                    ForEach(open) { task in TaskRowLink(model: model, task: task, showProject: false) }
                    if !done.isEmpty {
                        TextAction(label: "\(showDone ? "▾" : "▸")  Completed recently (\(done.count))") { showDone.toggle() }
                            .padding(.leading, -8)
                        if showDone { ForEach(done) { task in TaskRowLink(model: model, task: task, showProject: false) } }
                    }
                    if let doc = record?.doc_md, !doc.isEmpty {
                        SectionEyebrow(title: "Overview")
                        Text(doc).font(Typeface.sans(14)).foregroundStyle(Theme.ink2).lineSpacing(3)
                            .padding(.top, 12).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .background(Theme.bg)
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.surface, for: .navigationBar)
    }
}
