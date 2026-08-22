import AppIntents

/// "Add task to Jevi Ops" for Shortcuts / Action Button / Siri. Inbox-only
/// on purpose — the server files tasks with no domain to Inbox, and picker
/// entities aren't worth the AppEntity plumbing yet.
struct AddTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Add Task"
    static let description = IntentDescription("Creates a task in the jevi-ops Inbox.")
    static let openAppWhenRun = false

    @Parameter(title: "Title") var taskTitle: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let client = APIClient.forDevice, client.bearer != nil else {
            return .result(dialog: "Jevi Ops isn't linked yet — open the app and link this device first.")
        }
        do {
            try await client.createTask(CreateTaskPayload(title: taskTitle))
            return .result(dialog: "Added \"\(taskTitle)\" to your Inbox.")
        } catch {
            PendingQueue.append(CreateTaskPayload(title: taskTitle))
            return .result(dialog: "Server unreachable — saved \"\(taskTitle)\" to send later.")
        }
    }
}

struct JeviOpsShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTaskIntent(),
            phrases: ["Add a task to \(.applicationName)"],
            shortTitle: "Add Task",
            systemImageName: "plus.circle"
        )
    }
}
