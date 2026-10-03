import SwiftUI

/// One task row (TaskItem.tsx): the checkbox square (dashed while waiting),
/// the title, and a meta line — waiting · project with its colour dot · due
/// label · recurrence. The checkbox queues a status change offline.
struct TaskRow: View {
    @ObservedObject var model: OfflineModel
    var task: OfflineTask
    var showProject = true
    var parentCrumb: String?
    @State private var error: String?

    private var today: String { model.today }

    var body: some View {
        let waitDays = task.isWaiting ? task.waiting_since.flatMap { DueLabel.daysBetween($0, today) } : nil
        let waitStale = (waitDays ?? 0) >= 7
        let due = task.due_date.flatMap { DueLabel.format($0, today: today) }
        let pending = model.pendingEdit(for: task)
        HStack(alignment: .top, spacing: 12) {
            Button(action: toggle) {
                ZStack {
                    RoundedRectangle(cornerRadius: 0).fill(task.isDone ? Theme.ink2 : .clear)
                    RoundedRectangle(cornerRadius: 0)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: task.isWaiting ? [3, 2] : []))
                        .foregroundStyle(task.isDone ? Theme.ink2 : task.isWaiting ? (waitStale ? Theme.accent : Theme.ink3) : Theme.lineStrong)
                    if task.isDone { Icon(name: .check, size: 12, strokeWidth: 2, color: Theme.bg) }
                }
                .frame(width: 20, height: 20)
                .padding(.top, 2)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(task.isDone ? "Mark task open" : "Mark task done")
            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .font(Typeface.sans(14))
                    .foregroundStyle(task.isDone && task.workflow_status_id == nil ? Theme.ink3 : task.isWaiting ? Theme.ink2 : Theme.ink)
                    .strikethrough(task.isDone && task.workflow_status_id == nil, color: Theme.ink3.opacity(0.6))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                let metaParts = meta(waitDays: waitDays, waitStale: waitStale, due: due, pending: pending)
                if !metaParts.isEmpty {
                    HStack(spacing: 12) {
                        ForEach(Array(metaParts.enumerated()), id: \.offset) { _, part in part }
                    }
                }
                if let error { Text(error).font(Typeface.sans(11)).foregroundStyle(Theme.accent) }
            }
            Spacer(minLength: 0)
            if task.top3_for_date == today {
                Text("★").font(.system(size: 16)).foregroundStyle(Theme.accent).padding(.top, 2)
            }
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("taskRow-\(task.id)")
    }

    private func meta(waitDays: Int?, waitStale: Bool, due: (kind: DueLabel.Kind, text: String)?, pending: PendingTaskEdit?) -> [AnyView] {
        var parts: [AnyView] = []
        let mono = Typeface.mono(10)
        if let parentCrumb {
            parts.append(AnyView(Text("↳ \(parentCrumb)").font(Typeface.sans(11)).foregroundStyle(Theme.ink3).lineLimit(1)))
        }
        if task.isWaiting {
            var text = "⏸ Waiting"
            if let who = task.waiting_on { text += " on \(who)" }
            if let waitDays { text += " · \(waitDays)d" }
            parts.append(AnyView(Text(text.uppercased()).font(mono).tracking(0.8).foregroundStyle(waitStale ? Theme.accent : Theme.ink3)))
        }
        if showProject, let project = task.project {
            parts.append(AnyView(HStack(spacing: 6) {
                if let color = project.color.flatMap(Color.init(css:)) { Circle().fill(color).frame(width: 8, height: 8) }
                Text(project.name.uppercased()).font(mono).tracking(0.8).foregroundStyle(Theme.ink3).lineLimit(1)
            }))
        }
        if let due, !task.isDone, !task.isWaiting {
            parts.append(AnyView(Text(due.text.uppercased()).font(mono).tracking(0.8)
                .foregroundStyle(due.kind == .overdue ? Theme.accent : due.kind == .today ? Theme.ink2 : Theme.ink3)))
        }
        if let rule = task.recurrence_rule, let label = RECURRENCE_LABELS[rule] {
            parts.append(AnyView(Text("↻ \(label)".uppercased()).font(mono).tracking(0.8).foregroundStyle(Theme.ink3)))
        }
        if let pending {
            parts.append(AnyView(Pill(pending.blocked ? .over : .due, label: pending.blocked ? "Needs review" : "Pending sync", dot: false)))
        }
        return parts
    }

    private func toggle() {
        do { try model.toggleDone(task); error = nil }
        catch { self.error = error.localizedDescription }
    }
}

let RECURRENCE_LABELS: [String: String] = [
    "daily": "Daily", "weekdays": "Weekdays", "weekly": "Weekly", "fortnightly": "Fortnightly",
    "monthly": "Monthly", "quarterly": "Quarterly", "yearly": "Yearly",
]

struct TaskRowLink: View {
    @ObservedObject var model: OfflineModel
    var task: OfflineTask
    var showProject = true
    var body: some View {
        HStack(spacing: 0) {
            TaskRow(model: model, task: task, showProject: showProject)
            NavigationLink(value: DomainRoute.task(task.id)) {
                Icon(name: .chev, size: 14, color: Theme.ink4).frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open task: \(task.title)")
        }
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// /tasks/[id] — header band with the status control, computed stat strip,
/// notes, links, and the pending-edit / conflict panel from the offline queue.
struct TaskDetailView: View {
    @ObservedObject var model: OfflineModel
    var taskID: String
    var onWeb: (String) -> Void
    @State private var editing = false
    @State private var error: String?

    var body: some View {
        if let original = model.visibleTasks.first(where: { $0.id == taskID }) {
            let task = model.visibleTask(original)
            let pending = model.pendingEdit(for: task)
            let today = model.today
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    DetailHeader(crumb: crumb(task), name: task.title, color: task.project?.color.flatMap(Color.init(css:)),
                                 state: nil, titleSize: 30) {
                        StatusControl(model: model, task: task)
                        Spacer()
                        ActionButton(label: "Edit", variant: .solid) { editing = true }
                            .disabled(pending.map { $0.attempted && (!$0.blocked || $0.serverTask == nil) } ?? false)
                    }
                    StatStrip(tiles: [
                        StatTile(label: "Due", value: task.due_date.map { String($0.dropFirst(5)) } ?? "—",
                                 sub: task.due_date.flatMap { DueLabel.format($0, today: today)?.text },
                                 tone: task.due_date.flatMap { DueLabel.format($0, today: today) }?.kind == .overdue && !task.isDone ? .accent : .neutral),
                        StatTile(label: "Priority", value: "P\(task.priority)", sub: task.priority == 1 ? "highest" : task.priority == 4 ? "lowest" : nil,
                                 tone: task.priority == 1 ? .accent : .neutral),
                        StatTile(label: "Status", value: model.snapshot?.statusLabel(for: task) ?? task.status.capitalized,
                                 sub: task.isWaiting ? "on \(task.waiting_on ?? "someone")" : nil),
                        StatTile(label: "Repeats", value: task.recurrence_rule.flatMap { RECURRENCE_LABELS[$0] } ?? "No",
                                 sub: task.recurrence_rule != nil ? "completing rolls the date forward" : nil),
                    ])
                    if let pending { PendingEditPanel(model: model, edit: pending, onWeb: onWeb) }
                    VStack(alignment: .leading, spacing: 0) {
                        SectionEyebrow(title: "Notes")
                        Text(task.notes?.isEmpty == false ? task.notes! : "No notes yet.")
                            .font(Typeface.sans(14)).foregroundStyle(task.notes?.isEmpty == false ? Theme.ink : Theme.ink3)
                            .lineSpacing(3).padding(.top, 12).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                        SectionEyebrow(title: "Details")
                        detailRow("Domain", task.domain?.name ?? "Inbox")
                        if let project = task.project { detailRow(model.snapshot?.project(project.id)?.kind == "area" ? "Area" : "Project", project.name) }
                        if let parent = task.parent_task { detailRow("Parent task", parent.title) }
                        if let content = task.content_item { detailRow("Content", content.title) }
                        if let source = task.source, source != "manual" { detailRow("Source", "via \(source)") }
                        if let completed = task.completed_at { detailRow("Completed", String(completed.prefix(10))) }
                        ActionButton(label: "Open on web", variant: .ghost, icon: .arrow) { onWeb("/tasks/\(task.id)") }
                            .padding(.top, 20)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 40)
                    if let error { Notice(text: error, tone: .error) }
                }
            }
            .background(Theme.bg)
            .navigationTitle("Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.surface, for: .navigationBar)
            .sheet(isPresented: $editing) { TaskEditView(model: model, initial: task) }
        } else {
            VStack { Notice(text: "This task is no longer in the saved snapshot.") ; Spacer() }.background(Theme.bg)
        }
    }

    private func crumb(_ task: OfflineTask) -> [String] {
        var parts = [task.domain?.name ?? "Inbox"]
        if let project = task.project { parts.append(project.name) }
        parts.append("Task")
        return parts
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label.uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3).frame(width: 96, alignment: .leading)
            Text(value).font(Typeface.sans(14)).foregroundStyle(Theme.ink)
            Spacer()
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// The header's status control (TaskStatusControl): open / waiting / done, or
/// the scope's custom workflow labels when it defines them.
struct StatusControl: View {
    @ObservedObject var model: OfflineModel
    var task: OfflineTask
    @State private var error: String?

    var body: some View {
        let statuses = model.snapshot?.workflow(for: task)?.definition?.statuses
        Menu {
            if let statuses {
                ForEach(statuses, id: \.id) { status in
                    Button(status.label) { set(status.category, status.id) }
                }
            } else {
                Button("Open") { set("open", nil) }
                Button("Waiting") { set("waiting", nil) }
                Button("Done") { set("done", nil) }
            }
        } label: {
            HStack(spacing: 6) {
                Text((model.snapshot?.statusLabel(for: task) ?? task.status).uppercased()).font(Typeface.mono(10, .semibold)).tracking(0.7)
                Icon(name: .chev, size: 12, color: Theme.ink2).rotationEffect(.degrees(90))
            }
            .foregroundStyle(Theme.ink2)
            .padding(.horizontal, 12).frame(height: 34)
            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.lineStrong, lineWidth: 1))
        }
        .accessibilityLabel("Status")
    }

    private func set(_ category: String, _ workflowStatusId: String?) {
        do { try model.setStatus(task, category: category, workflowStatusId: workflowStatusId) }
        catch { self.error = error.localizedDescription }
    }
}

/// The queued-edit panel: pending sync, or the conflict review with the
/// server version and the two resolutions (keep server / reapply my fields).
struct PendingEditPanel: View {
    @ObservedObject var model: OfflineModel
    var edit: PendingTaskEdit
    var onWeb: (String) -> Void
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Pill(edit.blocked ? .over : .due, label: edit.blocked ? "Needs review" : "Pending sync", dot: false); Spacer() }
            Text(edit.error ?? "Your edit is saved on this phone and will sync when the server is reachable.")
                .font(Typeface.sans(13)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            if let path = edit.detailsPath {
                ActionButton(label: "Enter required details on web", variant: .ghost, icon: .arrow) { onWeb(path) }
            }
            if let server = edit.serverTask {
                Eyebrow(text: "Server version").padding(.top, 4)
                Text(server.title).font(Typeface.sans(14, .medium)).foregroundStyle(Theme.ink)
                Text(server.notes ?? "No notes").font(Typeface.sans(13)).foregroundStyle(Theme.ink2)
                Text("\(server.status) · due \(server.due_date ?? "none") · P\(server.priority)").font(Typeface.mono(10)).foregroundStyle(Theme.ink3)
                HStack(spacing: 8) {
                    ActionButton(label: "Use server version", variant: .ghost) { perform { try model.useServer(edit) } }
                    ActionButton(label: "Apply my changed fields", variant: .accent) { perform { try model.reapplyEdit(edit) } }
                }
            } else if edit.blocked {
                ActionButton(label: "Review latest server version", variant: .ghost) {
                    Task { do { try await model.reviewServerVersion(edit) } catch { self.error = error.localizedDescription } }
                }
            }
            if let error { Text(error).font(Typeface.sans(12)).foregroundStyle(Theme.accent) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(edit.blocked ? Theme.accentLine : Theme.line, lineWidth: 1))
        .padding(.horizontal, 20)
        .padding(.top, 20)
    }

    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { self.error = error.localizedDescription }
    }
}

/// The edit form (the web's Edit drawer): title, notes, due date, priority,
/// status — saved to the offline queue first.
struct TaskEditView: View {
    @ObservedObject var model: OfflineModel
    @State var task: OfflineTask
    @State private var due: Date?
    @State private var notes: String
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    init(model: OfflineModel, initial: OfflineTask) {
        self.model = model
        _task = State(initialValue: initial)
        _notes = State(initialValue: initial.notes ?? "")
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        _due = State(initialValue: initial.due_date.flatMap(formatter.date(from:)))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    FieldGroup(label: "Title") {
                        TextField("Title", text: $task.title, axis: .vertical).font(Typeface.sans(15)).bordered()
                            .accessibilityIdentifier("offlineTaskTitle")
                    }
                    FieldGroup(label: "Notes") {
                        TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...10).font(Typeface.sans(14)).bordered()
                            .accessibilityIdentifier("offlineTaskNotes")
                    }
                    FieldGroup(label: "Due date") {
                        HStack {
                            DatePicker("Due date", selection: Binding(get: { due ?? Date() }, set: { due = $0 }), displayedComponents: .date)
                                .labelsHidden().opacity(due == nil ? 0.45 : 1)
                            Spacer()
                            if due == nil { Button("Set") { due = Date() }.font(Typeface.mono(10, .semibold)).foregroundStyle(Theme.ink2) }
                            else { Button("Clear") { due = nil }.font(Typeface.mono(10, .semibold)).foregroundStyle(Theme.ink2) }
                        }
                        .bordered()
                    }
                    FieldGroup(label: "Priority") {
                        Picker("Priority", selection: $task.priority) {
                            ForEach(1...4, id: \.self) { Text("P\($0)").tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }
                    FieldGroup(label: "Status") {
                        if let statuses = model.snapshot?.workflow(for: task)?.definition?.statuses {
                            Picker("Status", selection: Binding(
                                get: { task.workflow_status_id ?? statuses.first { $0.category == task.status }?.id ?? "" },
                                set: { id in
                                    task.workflow_status_id = id
                                    if let selected = statuses.first(where: { $0.id == id }) { task.status = selected.category }
                                })) {
                                ForEach(statuses, id: \.id) { Text($0.label).tag($0.id) }
                            }
                            .pickerStyle(.menu).bordered()
                        } else {
                            Picker("Status", selection: $task.status) {
                                Text("Open").tag("open"); Text("Waiting").tag("waiting"); Text("Done").tag("done")
                            }
                            .pickerStyle(.segmented)
                        }
                    }
                    Text("Saved on this phone first. If the task changes on the server meanwhile, you review both versions before choosing.")
                        .font(Typeface.sans(12)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
                    if let error { Text(error).font(Typeface.sans(13)).foregroundStyle(Theme.accent) }
                }
                .padding(20)
            }
            .background(Theme.bg)
            .navigationTitle("Edit task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.surface, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("offlineTaskSave")
                }
            }
        }
    }

    private func save() {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        task.due_date = due.map(formatter.string(from:))
        task.notes = notes.isEmpty ? nil : notes
        do { try model.saveEdit(task); dismiss() } catch { self.error = error.localizedDescription }
    }
}
