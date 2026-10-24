import Foundation

/// The web project page's task organisation (apps/web/src/app/(authed)/
/// projects/[id]/page.tsx — KEEP IN SYNC): subtasks fold one level deep under
/// a live parent, and the remaining live pool groups by milestone or by due
/// window (Addendum 08 §10).
struct TaskGroup: Identifiable {
    let id: String
    let title: String
    let meta: String
    let tasks: [OfflineTask]
    var muted = false
    var accent = false
}

enum TaskGroupMode: String, CaseIterable {
    case milestone, due
    var label: String { self == .milestone ? "Milestone" : "Due window" }

    /// Milestones lead only on a target project that has them.
    static func defaultMode(project: OfflineProject?, milestones: [OfflineMilestone]) -> TaskGroupMode {
        project?.isArea != true && project?.isRetainer != true && !milestones.isEmpty ? .milestone : .due
    }
}

struct TaskOrganisation {
    /// Open and waiting tasks, minus children folded under a live parent.
    let pool: [OfflineTask]
    /// Done tasks, most recently completed first.
    let done: [OfflineTask]
    private let children: [String: [OfflineTask]]

    init(_ tasks: [OfflineTask]) {
        // The web lists in created_at-descending order before grouping.
        let ordered = tasks.sorted { ($0.created_at ?? "") > ($1.created_at ?? "") }
        var children: [String: [OfflineTask]] = [:]
        for task in ordered { if let parent = task.parent_task_id { children[parent, default: []].append(task) } }
        let live = Set(ordered.filter { !$0.isDone }.map(\.id))
        self.children = children
        pool = ordered.filter { task in !task.isDone && !(task.parent_task_id.map(live.contains) ?? false) }
        done = ordered.filter(\.isDone).sorted { ($0.completed_at ?? "") > ($1.completed_at ?? "") }
    }

    /// Every child, done included, so the fold chip can read done / total.
    func kids(of task: OfflineTask) -> [OfflineTask] { children[task.id] ?? [] }

    func groups(_ mode: TaskGroupMode, milestones: [OfflineMilestone], today: String) -> [TaskGroup] {
        mode == .milestone ? Self.milestoneGroups(pool, milestones: milestones) : Self.dueGroups(pool, today: today)
    }

    /// Waiting sinks below open; then earliest due first, undated last.
    static func sortPool(_ list: [OfflineTask]) -> [OfflineTask] {
        list.enumerated().sorted { a, b in
            let (aw, bw) = (a.element.isWaiting ? 1 : 0, b.element.isWaiting ? 1 : 0)
            if aw != bw { return aw < bw }
            let (ad, bd) = (a.element.due_date ?? "9999-99-99", b.element.due_date ?? "9999-99-99")
            return ad != bd ? ad < bd : a.offset < b.offset
        }.map(\.element)
    }

    static func milestoneGroups(_ pool: [OfflineTask], milestones: [OfflineMilestone]) -> [TaskGroup] {
        let ordered = milestones.enumerated().sorted { ($0.element.position, $0.offset) < ($1.element.position, $1.offset) }.map(\.element)
        let current = ordered.first { $0.status == "open" }?.id
        var groups: [TaskGroup] = ordered.compactMap { m in
            let tasks = sortPool(pool.filter { $0.milestone_id == m.id })
            guard !tasks.isEmpty else { return nil }
            let meta = m.status == "done" ? "done · weight \(m.weight)" : m.id == current ? "in progress · weight \(m.weight)" : "weight \(m.weight)"
            return TaskGroup(id: m.id, title: m.title, meta: meta, tasks: tasks, muted: m.status == "done")
        }
        // The web drops a task whose milestone isn't in the list; here it
        // lands in General so nothing goes missing from the phone.
        let known = Set(ordered.map(\.id))
        let general = sortPool(pool.filter { $0.milestone_id.map { !known.contains($0) } ?? true })
        if !general.isEmpty { groups.append(TaskGroup(id: "general", title: "General", meta: "no milestone", tasks: general)) }
        return groups
    }

    static func dueGroups(_ pool: [OfflineTask], today: String) -> [TaskGroup] {
        let plus7 = DueLabel.shift(today, days: 7) ?? today
        let open = pool.filter(\.isOpen)
        let buckets: [(String, String, [OfflineTask], Bool, Bool)] = [
            ("overdue", "Overdue", open.filter { ($0.due_date ?? "9999") < today }, false, true),
            ("today", "Today", open.filter { $0.due_date == today }, false, false),
            ("week", "This week", open.filter { $0.due_date.map { $0 > today && $0 <= plus7 } ?? false }, false, false),
            ("later", "Later", open.filter { $0.due_date.map { $0 > plus7 } ?? false }, false, false),
            ("undated", "Undated", open.filter { $0.due_date == nil }, false, false),
            ("waiting", "Waiting", pool.filter(\.isWaiting), true, false),
        ]
        return buckets.filter { !$0.2.isEmpty }.map { key, title, tasks, muted, accent in
            TaskGroup(id: key, title: title, meta: String(tasks.count), tasks: sortPool(tasks), muted: muted, accent: accent)
        }
    }
}
