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
                                    .accessibilityIdentifier("projectLink-\(project.name)")
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
/// retainer cycle, progress, counts), and tasks organised as on the web —
/// subtasks folded under their parent, grouped by milestone or due window,
/// custom statuses in place of checkboxes. Milestone editing, checklist and
/// the activity log remain on the web.
struct ProjectDetailView: View {
    @ObservedObject var model: OfflineModel
    var projectID: String
    var onCompose: (ComposeContext) -> Void
    var onWeb: (String) -> Void
    @State private var showDone: Bool?
    @State private var chosenMode: TaskGroupMode?

    private var modeKey: String { "projectGroupMode.\(projectID)" }

    private var found: (domain: WorkDomain, project: WorkProjectCard)? { model.work?.project(projectID) }
    private var record: OfflineProject? { model.snapshot?.project(projectID) }
    private var name: String { found?.project.name ?? record?.name ?? "Project" }
    private var domainName: String { found?.domain.name ?? model.snapshot?.domain(record?.domain_id)?.name ?? "Domains" }

    var body: some View {
        let organised = TaskOrganisation(model.tasks(inProject: projectID))
        let milestones = model.snapshot?.milestones(inProject: projectID) ?? []
        let mode = chosenMode ?? UserDefaults.standard.string(forKey: modeKey).flatMap(TaskGroupMode.init(rawValue:))
            ?? TaskGroupMode.defaultMode(project: record, milestones: milestones)
        let hasWorkflow = model.snapshot?.scopes.contains { $0.scope == "project" && $0.id == projectID && $0.definition != nil } ?? false
        let doneOpen = showDone ?? hasWorkflow
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
                    SectionEyebrow(title: "Tasks", count: organised.pool.count)
                    if organised.pool.isEmpty {
                        EmptyNote(text: "Nothing open here.")
                    } else {
                        GroupByPicker(mode: mode) { chosenMode = $0; UserDefaults.standard.set($0.rawValue, forKey: modeKey) }
                        ForEach(organised.groups(mode, milestones: milestones, today: model.today)) { group in
                            TaskGroupView(model: model, group: group, organised: organised)
                        }
                    }
                    if !organised.done.isEmpty {
                        TextAction(label: "\(doneOpen ? "▾" : "▸")  \(hasWorkflow ? "✓ \(organised.done.count) satisfied" : "Completed recently (\(organised.done.count))")") {
                            showDone = !doneOpen
                        }
                        .padding(.leading, -8)
                        if doneOpen { ForEach(organised.done) { task in TaskRowLink(model: model, task: task, showProject: false) } }
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

/// "Group by  Milestone  Due window" — the active mode underlined.
struct GroupByPicker: View {
    var mode: TaskGroupMode
    var onSelect: (TaskGroupMode) -> Void

    var body: some View {
        HStack(spacing: 16) {
            Text("GROUP BY").font(Typeface.mono(10)).tracking(1).foregroundStyle(Theme.ink3)
            ForEach(TaskGroupMode.allCases, id: \.self) { option in
                Button { onSelect(option) } label: {
                    Text(option.label.uppercased()).font(Typeface.mono(11)).tracking(0.8)
                        .foregroundStyle(option == mode ? Theme.ink : Theme.ink3)
                        .padding(.bottom, 2)
                        .overlay(alignment: .bottom) { Rectangle().fill(option == mode ? Theme.ink : .clear).frame(height: 1) }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(option == mode ? .isSelected : [])
                .accessibilityIdentifier("groupBy-\(option.rawValue)")
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 14).padding(.bottom, 4)
    }
}

/// One group: its title and meta (count, or milestone weight/progress),
/// then each task — a parent with live children becomes a fold.
struct TaskGroupView: View {
    @ObservedObject var model: OfflineModel
    var group: TaskGroup
    var organised: TaskOrganisation

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(group.title).font(Typeface.sans(14, .semibold)).foregroundStyle(group.muted ? Theme.ink3 : Theme.ink)
                Text(group.meta.uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(group.accent ? Theme.accent : Theme.ink3)
            }
            .padding(.top, 16).padding(.bottom, 4)
            ForEach(group.tasks) { task in
                let kids = organised.kids(of: task)
                if kids.isEmpty {
                    TaskRowLink(model: model, task: task, showProject: false)
                } else {
                    ParentFold(model: model, parent: task, kids: kids)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("taskGroup-\(group.id)")
    }
}

/// A parent task with children (ParentFold on the web, one level deep): the
/// disclosure, the title linking to the task, a done / total chip; open
/// children indent beneath a rule when expanded.
struct ParentFold: View {
    @ObservedObject var model: OfflineModel
    var parent: OfflineTask
    var kids: [OfflineTask]
    @State private var expanded = false

    var body: some View {
        let open = kids.filter { !$0.isDone }
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Button { withAnimation(.easeOut(duration: 0.15)) { expanded.toggle() } } label: {
                    Text("▶").font(Typeface.mono(10)).foregroundStyle(Theme.ink3)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                        .frame(width: 20, height: 20).padding(.top, 2)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(expanded ? "Collapse subtasks" : "Expand subtasks")
                NavigationLink(value: DomainRoute.task(parent.id)) {
                    HStack(alignment: .top, spacing: 8) {
                        Text(parent.title).font(Typeface.sans(14)).foregroundStyle(Theme.ink)
                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 2)
                        Spacer(minLength: 0)
                        Text("\(kids.count - open.count) / \(kids.count)")
                            .font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink2)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(Theme.surface2)
                            .padding(.top, 2)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open task: \(parent.title), \(kids.count - open.count) of \(kids.count) subtasks done")
            }
            .padding(.vertical, 8)
            if expanded {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(open) { kid in TaskRowLink(model: model, task: kid, showProject: false) }
                    if open.isEmpty { EmptyNote(text: "All subtasks done.") }
                }
                .padding(.leading, 16)
                .overlay(alignment: .leading) { Rectangle().fill(Theme.lineStrong).frame(width: 1) }
                .padding(.leading, 9)
                .padding(.bottom, 8)
            }
        }
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("parentFold-\(parent.id)")
    }
}
