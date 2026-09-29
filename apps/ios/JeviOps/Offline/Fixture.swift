import Foundation

#if DEBUG
/// A fully offline sample workspace for the UI tests and design review
/// screenshots: three domains with projects, assets, content and tasks in
/// every state the screens render. Launch with `-offline-ui-fixture`
/// (`-offline-ui-reset` wipes it first). Excluded from Release builds.
enum OfflineFixture {
    static let launchArgument = "-offline-ui-fixture"
    static let resetArgument = "-offline-ui-reset"

    static var isActive: Bool { ProcessInfo.processInfo.arguments.contains(launchArgument) }

    static let client = APIClient(baseURL: URL(string: "https://offline-fixture.invalid")!, bearer: "fixture-only")

    static let homeDomain = "22222222-2222-4222-8222-222222222222"
    static let financeDomain = "44444444-4444-4444-8444-444444444444"
    static let emptyDomain = "66666666-6666-4666-8666-666666666666"
    static let campingProject = "33333333-3333-4333-8333-333333333333"
    static let roofProject = "55555555-5555-4555-8555-555555555555"
    static let taxProject = "77777777-7777-4777-8777-777777777777"
    static let torchTask = "11111111-2222-4333-8444-555555555555"

    static func store() throws -> OfflineStore {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("OfflineUITest")
        if ProcessInfo.processInfo.arguments.contains(resetArgument) { try? FileManager.default.removeItem(at: root) }
        let store = try OfflineStore(root: root)
        let destination = OfflineStore.destination(for: client)
        if (try? store.snapshot(for: destination)) == nil {
            try store.saveSnapshot(snapshot(destination: destination))
        }
        return store
    }

    static func snapshot(destination: String) -> TaskSnapshot {
        let identity = SyncIdentity(task_edit_protocol: 1, dataSpaceId: "11111111-2222-4333-8444-555555555555", serverEpoch: 1)
        let today = DueLabel.today(in: "America/Denver")
        func shift(_ days: Int) -> String {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: "America/Denver")
            formatter.dateFormat = "yyyy-MM-dd"
            return formatter.string(from: Calendar.current.date(byAdding: .day, value: days, to: Date())!)
        }
        let home = OfflineTask.Ref(id: homeDomain, name: "Home & Property")
        let finance = OfflineTask.Ref(id: financeDomain, name: "Finance")
        let camping = OfflineTask.Ref(id: campingProject, name: "Camping kit", color: "#3B6A52")
        let roof = OfflineTask.Ref(id: roofProject, name: "Roof repair", color: "#8A4B3C")
        let tax = OfflineTask.Ref(id: taxProject, name: "Tax return", color: "#A8763E")
        let stamp = "2026-09-24T01:02:03.000Z"
        var tasks: [OfflineTask] = [
            OfflineTask(id: torchTask, title: "Pack the torch", status: "open", notes: "Spare batteries are in the drawer",
                        due_date: shift(1), project_id: campingProject, domain_id: homeDomain, project: camping, domain: home,
                        updated_at: stamp, priority: 2),
            OfflineTask(id: "a1111111-0000-4000-8000-000000000001", title: "Book the campsite", status: "waiting",
                        project_id: campingProject, domain_id: homeDomain, project: camping, domain: home,
                        waiting_on: "Sam", waiting_since: shift(-9), updated_at: stamp, priority: 3),
            OfflineTask(id: "a1111111-0000-4000-8000-000000000002", title: "Get roofer quotes", status: "open",
                        due_date: shift(-3), project_id: roofProject, domain_id: homeDomain, project: roof, domain: home,
                        updated_at: stamp, priority: 1),
            OfflineTask(id: "a1111111-0000-4000-8000-000000000003", title: "Clear the gutters", status: "done",
                        project_id: roofProject, domain_id: homeDomain, project: roof, domain: home,
                        completed_at: stamp, updated_at: stamp, priority: 4),
            OfflineTask(id: "a1111111-0000-4000-8000-000000000004", title: "Water the lemon tree", status: "open",
                        due_date: today, domain_id: homeDomain, domain: home, recurrence_rule: "weekly", updated_at: stamp, priority: 3),
            OfflineTask(id: "a1111111-0000-4000-8000-000000000005", title: "Replace smoke alarm batteries", status: "open",
                        domain_id: homeDomain, domain: home, updated_at: stamp, priority: 4),
            OfflineTask(id: "a1111111-0000-4000-8000-000000000006", title: "Gather receipts for the accountant", status: "open",
                        due_date: shift(12), project_id: taxProject, domain_id: financeDomain, project: tax, domain: finance,
                        updated_at: stamp, priority: 2),
            OfflineTask(id: "a1111111-0000-4000-8000-000000000007", title: "Renew car insurance", status: "open",
                        notes: "Compare at least two quotes.", due_date: shift(5), domain_id: financeDomain, domain: finance,
                        updated_at: stamp, priority: 3),
        ]
        tasks[0].top3_for_date = today
        // Engravings as the server sends them: the procedural motif each name
        // seeds (packages/shared/src/illustration.ts), captured verbatim.
        let domains = [
            OfflineDomain(illustration: .init(svg: "<circle class=\"f\" cx=\"185.83\" cy=\"23.15\" r=\"6\"/><path class=\"f\" stroke-width=\"0.6\" d=\"M 47.09 26.92 q 4 -5 9 -2 q 5 -4 9 1\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"166.39\" y1=\"74\" x2=\"166.39\" y2=\"68\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"166.39\" y1=\"69.6\" x2=\"175.39\" y2=\"69.6\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"175.39\" y1=\"74\" x2=\"175.39\" y2=\"68\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"175.39\" y1=\"69.6\" x2=\"184.39\" y2=\"69.6\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"184.39\" y1=\"74\" x2=\"184.39\" y2=\"68\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"184.39\" y1=\"69.6\" x2=\"193.39\" y2=\"69.6\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"193.39\" y1=\"74\" x2=\"193.39\" y2=\"68\"/><polyline points=\"72.95,48.26 106.67,30.26 140.39,48.26\"/><line x1=\"78.95\" y1=\"45.26\" x2=\"78.95\" y2=\"74\"/><line x1=\"134.39\" y1=\"45.26\" x2=\"134.39\" y2=\"74\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"111.48\" y1=\"32.84\" x2=\"106.48\" y2=\"36.24\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"116.3\" y1=\"35.41\" x2=\"111.3\" y2=\"38.81\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"121.12\" y1=\"37.98\" x2=\"116.12\" y2=\"41.38\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"125.94\" y1=\"40.55\" x2=\"120.94\" y2=\"43.95\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"130.75\" y1=\"43.12\" x2=\"125.75\" y2=\"46.52\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"135.57\" y1=\"45.69\" x2=\"130.57\" y2=\"49.09\"/><rect class=\"f\" x=\"101.67\" y=\"56.26\" width=\"10\" height=\"17.74\"/><circle class=\"f\" stroke-width=\"0.6\" cx=\"109.27\" cy=\"65.13\" r=\"0.8\"/><rect class=\"f\" x=\"117.84\" y=\"54.26\" width=\"8\" height=\"8\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"121.84\" y1=\"54.26\" x2=\"121.84\" y2=\"62.26\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"117.84\" y1=\"58.26\" x2=\"125.84\" y2=\"58.26\"/><line x1=\"119.44\" y1=\"36.86\" x2=\"119.44\" y2=\"27.26\"/><line x1=\"124.24\" y1=\"38.86\" x2=\"124.24\" y2=\"27.26\"/><line x1=\"119.44\" y1=\"27.26\" x2=\"124.24\" y2=\"27.26\"/><path class=\"f\" stroke-width=\"0.6\" d=\"M 121.84 24.26 q -3 -4 0 -8 q 3 -4 0 -8\"/><line class=\"f\" x1=\"28.67\" y1=\"74\" x2=\"184.67\" y2=\"74\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"58.89\" y1=\"74\" x2=\"55.89\" y2=\"67\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"51.57\" y1=\"74\" x2=\"48.57\" y2=\"67\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"43.58\" y1=\"74\" x2=\"40.58\" y2=\"67\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"38.36\" y1=\"74\" x2=\"35.36\" y2=\"67\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"30.56\" y1=\"74\" x2=\"27.56\" y2=\"67\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"73.3\" y1=\"74\" x2=\"73.38\" y2=\"68.7\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"87.29\" y1=\"74\" x2=\"87.12\" y2=\"69.96\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"106.43\" y1=\"74\" x2=\"106.98\" y2=\"68.6\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"120.63\" y1=\"74\" x2=\"120.72\" y2=\"68.77\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"137.67\" y1=\"74\" x2=\"137.73\" y2=\"69.42\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"151.4\" y1=\"74\" x2=\"151.95\" y2=\"69.56\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"89.96\" y1=\"76\" x2=\"97.03\" y2=\"76\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"101.52\" y1=\"76\" x2=\"107.08\" y2=\"76\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"110.17\" y1=\"76\" x2=\"117.41\" y2=\"76\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"122.27\" y1=\"76\" x2=\"129.25\" y2=\"76\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"130.56\" y1=\"76\" x2=\"136.97\" y2=\"76\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"97.36\" y1=\"78\" x2=\"105.69\" y2=\"78\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"111.58\" y1=\"78\" x2=\"118.46\" y2=\"78\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"120.49\" y1=\"78\" x2=\"127.39\" y2=\"78\"/>"), id: homeDomain, name: "Home & Property",
                          description: "The house, the garden and everything that keeps them standing."),
            OfflineDomain(illustration: .init(svg: "<line class=\"f\" x1=\"50\" y1=\"26\" x2=\"178\" y2=\"26\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"50\" y1=\"30\" x2=\"178\" y2=\"30\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"62\" y1=\"34\" x2=\"62\" y2=\"72\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"88\" y1=\"34\" x2=\"88\" y2=\"72\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"114\" y1=\"34\" x2=\"114\" y2=\"72\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"140\" y1=\"34\" x2=\"140\" y2=\"72\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"166\" y1=\"34\" x2=\"166\" y2=\"72\"/><ellipse cx=\"74\" cy=\"70\" rx=\"9\" ry=\"3\"/><ellipse class=\"f\" cx=\"74\" cy=\"63\" rx=\"9\" ry=\"3\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"66\" y1=\"76.6\" x2=\"78\" y2=\"76.6\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"69\" y1=\"78.6\" x2=\"81\" y2=\"78.6\"/><ellipse cx=\"100\" cy=\"70\" rx=\"9\" ry=\"3\"/><ellipse class=\"f\" cx=\"100\" cy=\"63\" rx=\"9\" ry=\"3\"/><ellipse cx=\"100\" cy=\"56\" rx=\"9\" ry=\"3\"/><ellipse class=\"f\" cx=\"100\" cy=\"49\" rx=\"9\" ry=\"3\"/><ellipse cx=\"100\" cy=\"42\" rx=\"9\" ry=\"3\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"92\" y1=\"76.6\" x2=\"104\" y2=\"76.6\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"95\" y1=\"78.6\" x2=\"107\" y2=\"78.6\"/><ellipse cx=\"126\" cy=\"70\" rx=\"9\" ry=\"3\"/><ellipse class=\"f\" cx=\"126\" cy=\"63\" rx=\"9\" ry=\"3\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"118\" y1=\"76.6\" x2=\"130\" y2=\"76.6\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"121\" y1=\"78.6\" x2=\"133\" y2=\"78.6\"/><ellipse cx=\"152\" cy=\"70\" rx=\"9\" ry=\"3\"/><ellipse class=\"f\" cx=\"152\" cy=\"63\" rx=\"9\" ry=\"3\"/><ellipse cx=\"152\" cy=\"56\" rx=\"9\" ry=\"3\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"144\" y1=\"76.6\" x2=\"156\" y2=\"76.6\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"147\" y1=\"78.6\" x2=\"159\" y2=\"78.6\"/><circle cx=\"184\" cy=\"68\" r=\"6\"/><circle class=\"f\" stroke-width=\"0.6\" cx=\"184\" cy=\"68\" r=\"3.6\"/><path class=\"f\" d=\"M 42 74 Q 50 56 58 44\"/><path class=\"f\" stroke-width=\"0.6\" d=\"M 52 60 q 6 -2 10 -8\"/><line class=\"f\" x1=\"50\" y1=\"74\" x2=\"178\" y2=\"74\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"67.33\" y1=\"74\" x2=\"66.62\" y2=\"69.29\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"88.22\" y1=\"74\" x2=\"88.77\" y2=\"69.28\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"114.64\" y1=\"74\" x2=\"114.52\" y2=\"70.32\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"136.2\" y1=\"74\" x2=\"135.75\" y2=\"70.97\"/><line class=\"f\" stroke-width=\"0.6\" x1=\"162.68\" y1=\"74\" x2=\"163.42\" y2=\"69.65\"/>"), id: financeDomain, name: "Finance",
                          description: "Money in, money out, and the paperwork between."),
            OfflineDomain(id: emptyDomain, name: "Empty domain"),
        ]
        let projects = [
            OfflineProject(id: campingProject, name: "Camping kit", domain_id: homeDomain, kind: "target", status: "active", color: "#3B6A52"),
            OfflineProject(id: roofProject, name: "Roof repair", domain_id: homeDomain, kind: "target", status: "active", color: "#8A4B3C"),
            OfflineProject(id: taxProject, name: "Tax return", domain_id: financeDomain, kind: "retainer", status: "active", color: "#A8763E"),
            OfflineProject(id: "88888888-8888-4888-8888-888888888888", name: "Empty project", domain_id: homeDomain, kind: "area", status: "active"),
        ]
        var work = WorkPayload()
        work.domains = [
            WorkDomain(id: homeDomain, name: "Home & Property", urgency: .over,
                       rollup: WorkRollup(attention: 1, open: 5, overdue: 1, waiting: 1),
                       assets: [WorkAssetCard(id: "99999999-9999-4999-8999-999999999999", name: "Subaru Outback", kind: "vehicle",
                                              meter_unit: "km", latest_reading: 148_230, latest_reading_days_ago: 12,
                                              maintenance: .init(total: 4, overdue: 0, due: 1, due_soon: 1), worst: "due", data: "complete",
                                              projects: 0, urgency: .due)],
                       projects: [
                           WorkProjectCard(id: campingProject, kind: "target", name: "Camping kit", target: shift(20), pct: 40,
                                           open: 1, overdue: 0, waiting: 1, waitOn: "Sam", waitDays: 9, recency: "active 2d ago", urgency: .ok),
                           WorkProjectCard(id: roofProject, kind: "target", name: "Roof repair", client: "Ridgeline Roofing", target: shift(4),
                                           pct: 15, open: 1, overdue: 1, waiting: 0, recency: "active today", flagged: true, urgency: .over),
                           WorkProjectCard(id: "88888888-8888-4888-8888-888888888888", kind: "retainer", name: "Empty project",
                                           open: 0, recency: "quiet 30d", urgency: .quiet),
                       ],
                       content: [WorkContentRow(id: "c1111111-0000-4000-8000-000000000001", title: "How we re-roofed on a budget",
                                                type: "article", status: "editing", holder: "me", days: 3, move: "finish the draft", urgency: .due)],
                       direct: WorkDirect(open: 2, overdue: 0, waiting: 0, waitingAging: 0, today: 1)),
            WorkDomain(id: financeDomain, name: "Finance", urgency: .ok,
                       rollup: WorkRollup(attention: 0, open: 2, overdue: 0, waiting: 0),
                       projects: [WorkProjectCard(id: taxProject, kind: "retainer", name: "Tax return", cycle: .init(day: 9, length: 30),
                                                  open: 1, recency: "active 5d ago", urgency: .ok)],
                       direct: WorkDirect(open: 1, overdue: 0, waiting: 0, waitingAging: 0, today: 0)),
            WorkDomain(id: emptyDomain, name: "Empty domain", urgency: .quiet),
        ]
        work.ideasCount = 3
        var snapshot = TaskSnapshot(destination: destination, tasks: tasks, scopes: [], identity: identity, domains: domains, projects: projects)
        snapshot.work = work
        snapshot.timezone = "America/Denver"
        snapshot.done_window_days = 30
        return snapshot
    }
}
#endif
