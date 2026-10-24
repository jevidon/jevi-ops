import XCTest

/// The native port of the web project page's organisation
/// (projects/[id]/page.tsx): folds, milestone groups and due windows.
final class TaskGroupingTests: XCTestCase {
    private let today = "2026-10-03"

    private func task(_ id: String, _ status: String = "open", due: String? = nil, parent: String? = nil,
                      milestone: String? = nil, created: String = "2026-09-01T00:00:00Z", completed: String? = nil) -> OfflineTask {
        var t = OfflineTask(id: id, title: id, status: status, due_date: due, parent_task_id: parent, completed_at: completed)
        t.milestone_id = milestone
        t.created_at = created
        return t
    }

    func testChildrenFoldUnderALiveParentOnly() {
        let organised = TaskOrganisation([
            task("parent"),
            task("kid-open", parent: "parent"),
            task("kid-done", "done", parent: "parent", completed: "2026-10-01T00:00:00Z"),
            task("orphan", parent: "done-parent"),
            task("done-parent", "done", completed: "2026-09-30T00:00:00Z"),
        ])
        XCTAssertEqual(Set(organised.pool.map(\.id)), ["parent", "orphan"])
        XCTAssertEqual(organised.kids(of: organised.pool.first { $0.id == "parent" }!).map(\.id).sorted(), ["kid-done", "kid-open"])
        XCTAssertEqual(organised.done.map(\.id), ["kid-done", "done-parent"])
    }

    func testDueWindowsBucketOpenTasksAndKeepWaitingApart() {
        let groups = TaskOrganisation([
            task("overdue", due: "2026-10-01"), task("today", due: today), task("week", due: "2026-10-10"),
            task("later", due: "2026-10-11"), task("undated"), task("waiting", "waiting", due: "2026-09-01"),
        ]).groups(.due, milestones: [], today: today)
        XCTAssertEqual(groups.map(\.id), ["overdue", "today", "week", "later", "undated", "waiting"])
        XCTAssertEqual(groups.map { $0.tasks.map(\.id) }, [["overdue"], ["today"], ["week"], ["later"], ["undated"], ["waiting"]])
        XCTAssertTrue(groups[0].accent)
        XCTAssertTrue(groups[5].muted)
        XCTAssertEqual(groups[0].meta, "1")
    }

    func testMilestoneGroupsFollowPositionAndMarkTheCurrentOne() {
        let milestones = [
            OfflineMilestone(id: "m2", project_id: "p", title: "Second", weight: 3, position: 2),
            OfflineMilestone(id: "m0", project_id: "p", title: "Done one", status: "done", weight: 1, position: 0),
            OfflineMilestone(id: "m1", project_id: "p", title: "Current", weight: 2, position: 1),
            OfflineMilestone(id: "empty", project_id: "p", title: "Empty", position: 3),
        ]
        let groups = TaskOrganisation([
            task("a", milestone: "m2"), task("b", milestone: "m1"), task("c", milestone: "m0"),
            task("loose"), task("stray", milestone: "elsewhere"),
        ]).groups(.milestone, milestones: milestones, today: today)
        XCTAssertEqual(groups.map(\.title), ["Done one", "Current", "Second", "General"])
        XCTAssertEqual(groups.map(\.meta), ["done · weight 1", "in progress · weight 2", "weight 3", "no milestone"])
        XCTAssertTrue(groups[0].muted)
        XCTAssertEqual(Set(groups[3].tasks.map(\.id)), ["loose", "stray"])
    }

    func testPoolSortsWaitingLastThenByDueThenNewestFirst() {
        let sorted = TaskOrganisation([
            task("old-undated", created: "2026-09-01T00:00:00Z"), task("new-undated", created: "2026-09-02T00:00:00Z"),
            task("waiting", "waiting", due: "2026-09-01"), task("soon", due: "2026-10-04"),
        ]).groups(.milestone, milestones: [], today: today)[0].tasks.map(\.id)
        XCTAssertEqual(sorted, ["soon", "new-undated", "old-undated", "waiting"])
    }

    func testDefaultModeMatchesTheWeb() {
        let milestone = [OfflineMilestone(id: "m", project_id: "p", title: "M")]
        XCTAssertEqual(TaskGroupMode.defaultMode(project: OfflineProject(id: "p", name: "P", kind: "project"), milestones: milestone), .milestone)
        XCTAssertEqual(TaskGroupMode.defaultMode(project: OfflineProject(id: "p", name: "P", kind: "project"), milestones: []), .due)
        XCTAssertEqual(TaskGroupMode.defaultMode(project: OfflineProject(id: "p", name: "P", kind: "area"), milestones: milestone), .due)
        XCTAssertEqual(TaskGroupMode.defaultMode(project: OfflineProject(id: "p", name: "P", kind: "project", engagement_type: "retainer"),
                                                 milestones: milestone), .due)
    }

    func testCustomStatusMustMatchTheTaskCategory() {
        var t = task("t", "done")
        t.project_id = "p"
        t.workflow_status_id = "buy"  // stale: an open status on a done task
        let snapshot = TaskSnapshot(destination: "d", tasks: [t], scopes: [OfflineWorkflow(id: "p", scope: "project", definition: .init(statuses: [
            .init(id: "buy", label: "Need to buy", category: "open"),
            .init(id: "packed", label: "Packed", category: "done"),
        ]))])
        XCTAssertEqual(snapshot.statusLabel(for: t), "Packed")
    }

    func testShiftCrossesMonthAndDSTBoundaries() {
        XCTAssertEqual(DueLabel.shift("2026-09-28", days: 7), "2026-10-05")
        XCTAssertEqual(DueLabel.shift("2026-11-01", days: 7), "2026-11-08")
        XCTAssertEqual(DueLabel.shift("2026-04-05", days: 1), "2026-04-06")
    }
}
