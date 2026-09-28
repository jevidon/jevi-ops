import SwiftUI
import AVKit

struct NativeHomeView: View {
    @EnvironmentObject private var config: AppConfig
    @EnvironmentObject private var router: AppRouter
    @StateObject private var model: OfflineModel
    private enum Sheet: String, Identifiable { case capture, captures, settings, newTask; var id: String { rawValue } }
    @State private var sheet: Sheet?
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-offline-ui-fixture") {
            let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("OfflineUITest")
            if ProcessInfo.processInfo.arguments.contains("-offline-ui-reset") { try? FileManager.default.removeItem(at: root) }
            let store = try! OfflineStore(root: root)
            let client = APIClient(baseURL: URL(string: "https://offline-fixture.invalid")!, bearer: "fixture-only")
            let destination = OfflineStore.destination(for: client)
            if (try? store.snapshot(for: destination)) == nil {
                let domainID = "22222222-2222-4222-8222-222222222222"
                let projectID = "33333333-3333-4333-8333-333333333333"
                let task = OfflineTask(id: "11111111-2222-4333-8444-555555555555", title: "Pack the torch", status: "open",
                    notes: "Spare batteries are in the drawer", project_id: projectID, domain_id: domainID,
                    project: .init(id: projectID, name: "Camping kit"),
                    updated_at: "2026-09-24T01:02:03.000Z")
                try! store.saveSnapshot(TaskSnapshot(destination: destination, tasks: [task], scopes: [],
                    identity: SyncIdentity(task_edit_protocol: 1, dataSpaceId: "11111111-2222-4333-8444-555555555555", serverEpoch: 1),
                    domains: [.init(id: domainID, name: "Personal"), .init(id: "44444444-4444-4444-8444-444444444444", name: "Empty domain")],
                    projects: [.init(id: projectID, name: "Camping kit", domain_id: domainID), .init(id: "55555555-5555-4555-8555-555555555555", name: "Empty project", domain_id: domainID)]))
            }
            let fixture = OfflineModel(store: store, monitorNetwork: false)
            fixture.useOfflineFixture(client: client)
            _model = StateObject(wrappedValue: fixture)
            return
        }
        #endif
        _model = StateObject(wrappedValue: OfflineModel())
    }

    var body: some View {
        LocalWorkspaceView(model: model, onAction: handleAction)
        .ignoresSafeArea()
        .sheet(item: $sheet) { selected in
            NavigationStack {
                Group {
                    switch selected {
                    case .capture: NativeCaptureView(model: model)
                    case .captures: CaptureLibraryView(model: model)
                    case .newTask: NewTaskSheet()
                    case .settings:
                        if config.onboarded { SettingsView(onReload: { Task { await model.refresh() } }) }
                        else { OnboardingView() }
                    }
                }
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { sheet = nil } } }
            }
        }
        .onChange(of: router.pendingRoute) { _, _ in consumeRoute() }
        .onAppear { consumeRoute() }
        .onChange(of: config.apiBaseURL) { _, _ in model.loadSnapshot() }
        .onChange(of: config.onboarded) { _, _ in Task { await model.refresh() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() }; PendingQueue.flushSoon() }
            if phase == .background { model.stopRecording() }
        }
        .task {
            model.loadSnapshot()
            if !ProcessInfo.processInfo.arguments.contains("-offline-ui-fixture") {
                await ReferenceCache.refresh()
                PendingQueue.flushSoon()
            }
            while !Task.isCancelled {
                await model.foregroundTick()
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
            }
        }
    }

    private func handleAction(_ action: String) {
        switch action {
        case "capture": sheet = .capture
        case "captures": sheet = .captures
        case "settings": sheet = .settings
        case "agenda": openWeb("/")
        case "online": openWeb("/work")
        default: if action.hasPrefix("details:") { openWeb(String(action.dropFirst("details:".count))) }
        }
    }

    private func openWeb(_ path: String) {
        guard let base = config.webURL, let url = URL(string: path, relativeTo: base) else { sheet = .settings; return }
        UIApplication.shared.open(url)
    }

    private func consumeRoute() {
        guard let route = router.pendingRoute else { return }
        router.pendingRoute = nil
        switch route {
        case .newTask: sheet = .newTask
        case .settings: sheet = .settings
        case .openPath(let path): openWeb(path)
        }
    }
}

private struct NativeCaptureView: View {
    @ObservedObject var model: OfflineModel
    @State private var note = ""
    @State private var message: String?
    @State private var startingRecording = false
    @FocusState private var noteFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Write a note…", text: $note, axis: .vertical)
                        .lineLimit(6...18)
                        .accessibilityIdentifier("offlineNote")
                        .focused($noteFocused)
                        .disabled(model.recordingID != nil || startingRecording)
                    Button("Save note on phone") {
                        do { try model.saveNote(note); note = ""; noteFocused = false; message = "Saved on this phone." }
                        catch { message = error.localizedDescription }
                    }
                    .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.recordingID != nil || startingRecording)
                } header: { Text("Capture") } footer: {
                    Text("Saves immediately on this phone, including in airplane mode. Delivery resumes when this app is open and the server is reachable.")
                }
                Section {
                    if model.recordingID != nil {
                        Label("Recording", systemImage: "record.circle.fill").foregroundStyle(.red)
                        Button("Stop and save recording") { model.stopRecording(); note = "" }
                    } else {
                        Button(startingRecording ? "Opening microphone…" : "Record audio") {
                            noteFocused = false
                            startingRecording = true
                            Task {
                                defer { startingRecording = false }
                                do { try await model.startRecording(note: note) }
                                catch { message = error.localizedDescription }
                            }
                        }.disabled(startingRecording)
                    }
                    if let recordingMessage = model.recordingMessage { Text(recordingMessage).font(.callout) }
                } header: { Text("Voice note") } footer: {
                    Text("Up to 10 minutes per recording. Audio stays on this phone for offline playback. Recording stops and saves when the app backgrounds or audio is interrupted. Local transcription is not available yet.")
                }
                if let message { Section { Text(message).accessibilityIdentifier("captureMessage") } }
                if let error = model.storageError { Section("Storage needs attention") { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Capture")
        }
    }
}

private struct CaptureLibraryView: View {
    @ObservedObject var model: OfflineModel
    @State private var search = ""

    var body: some View {
        NavigationStack {
            List {
                if !model.networkAvailable { Text("Offline · everything here is saved on this phone").font(.caption).foregroundStyle(.secondary) }
                if let message = model.connectionMessage { Text(message).font(.caption).foregroundStyle(.secondary) }
                if model.captures.isEmpty { Text("Your saved notes and recordings will appear here, even offline.").foregroundStyle(.secondary) }
                if let error = model.storageError { Text(error).foregroundStyle(.red) }
                ForEach(model.captures.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) || $0.text.localizedCaseInsensitiveContains(search) }) { capture in
                    NavigationLink {
                        CaptureDetailView(model: model, id: capture.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Label(capture.title, systemImage: capture.hasRecording ? "waveform" : "note.text").lineLimit(2)
                            Text(capture.createdAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                            Text(capture.deliveredAt != nil ? "Delivered · saved on phone" : (capture.ready ? "Saved on phone · pending delivery" : "Recording needs recovery"))
                                .font(.caption).foregroundStyle(capture.blocked ? .orange : .secondary)
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "Search saved captures")
            .navigationTitle("Captures")
            .toolbar { Button(model.syncing ? "Syncing…" : "Sync") { Task { await model.sendPending(retryBlocked: true) } }.disabled(model.syncing) }
        }
    }
}

private struct CaptureDetailView: View {
    @ObservedObject var model: OfflineModel
    let id: UUID
    @State private var player: AVPlayer?
    @State private var error: String?

    var body: some View {
        if let capture = model.captures.first(where: { $0.id == id }) {
            List {
                Text(capture.text.isEmpty ? "Voice recording" : capture.text).textSelection(.enabled)
                if capture.hasRecording, let url = model.store?.recordingURL(id) {
                    Button("Play recording") {
                        do {
                            try AVAudioSession.sharedInstance().setCategory(.playback)
                            player = AVPlayer(url: url)
                            player?.play()
                        } catch { self.error = error.localizedDescription }
                    }.disabled(model.recordingID != nil)
                    Button("Stop playback") { player?.pause() }
                    ShareLink("Export recording", item: url)
                    if !capture.recordingFinished && model.recordingID != id {
                        Button("Recover interrupted recording") {
                            do { try model.recoverRecording(id) }
                            catch { self.error = error.localizedDescription }
                        }
                    }
                }
                ShareLink("Export note", item: capture.text)
                Text(capture.deliveredAt != nil ? "Delivered. The original remains available on this phone." : "Saved locally. Delivery is pending.")
                if let failure = capture.deliveryError { Text(failure).foregroundStyle(.orange) }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("Saved capture")
            .onDisappear { player?.pause() }
        }
    }
}

private struct OfflineTasksView: View {
    @ObservedObject var model: OfflineModel
    @State private var search = ""
    @State private var group = "all"

    private var tasks: [OfflineTask] {
        model.visibleTasks.filter {
            (group == "all" || $0.listID == group) &&
            (search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) || ($0.notes ?? "").localizedCaseInsensitiveContains(search))
        }.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            List {
                if let snapshot = model.snapshot {
                    Section {
                        Text("Last downloaded \(snapshot.fetchedAt.formatted(date: .abbreviated, time: .shortened))").font(.caption)
                        Picker("List", selection: $group) {
                            Text("All").tag("all")
                            ForEach(Array(Set(model.visibleTasks.map(\.listID))).sorted(), id: \.self) { id in
                                Text(model.visibleTasks.first { $0.listID == id }?.listName ?? id).tag(id)
                            }
                        }
                    }
                    ForEach(tasks) { task in
                        NavigationLink {
                            OfflineTaskDetail(model: model, taskID: task.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(task.title)
                                Text("\(snapshot.statusLabel(for: task)) · \(task.project?.name ?? task.domain?.name ?? "Inbox")").font(.caption).foregroundStyle(.secondary)
                                if let edit = model.pendingEdit(for: task) {
                                    Text(edit.blocked ? "Needs attention" : "Pending sync").font(.caption).foregroundStyle(.orange)
                                }
                            }
                        }
                    }
                } else {
                    Text("No task copy saved yet. Link this device in Settings and sync once while connected to the server.")
                }
                if let message = model.connectionMessage { Text(message).font(.caption).foregroundStyle(.secondary) }
                if let error = model.storageError { Text(error).foregroundStyle(.red) }
            }
            .searchable(text: $search, prompt: "Search tasks and notes")
            .navigationTitle("Tasks & Lists")
            .toolbar { Button(model.refreshing ? "Syncing…" : "Sync") { Task { await model.refresh() } }.disabled(model.refreshing) }
        }
    }
}

private struct OfflineTaskDetail: View {
    @ObservedObject var model: OfflineModel
    @EnvironmentObject private var router: AppRouter
    let taskID: String
    @State private var editing = false
    @State private var error: String?

    var body: some View {
        if let original = model.visibleTasks.first(where: { $0.id == taskID }) {
            let task = model.visibleTask(original)
            List {
                Section {
                    Text(task.title).font(.headline)
                    Text(task.notes ?? "No notes").textSelection(.enabled)
                    LabeledContent("Status", value: model.snapshot?.statusLabel(for: task) ?? task.status)
                    LabeledContent("Due", value: task.due_date ?? "No date")
                    LabeledContent("Priority", value: String(task.priority))
                }
                if let edit = model.pendingEdit(for: task) {
                    Section(edit.blocked ? "Needs attention" : "Pending sync") {
                        Text(edit.error ?? "Your edit is saved on this phone.")
                        if let path = edit.detailsPath {
                            Button("Enter required details online") { router.pendingRoute = .openPath(path) }
                        }
                        if let server = edit.serverTask {
                            Text("Server version").font(.headline)
                            Text(server.title)
                            Text(server.notes ?? "No notes")
                            Text("\(server.status) · Due \(server.due_date ?? "none") · Priority \(server.priority)")
                            Button("Use server version") { perform { try model.useServer(edit) } }
                            Button("Apply my edit to this server version") { perform { try model.reapplyEdit(edit) } }
                        } else if edit.blocked {
                            Button("Review latest server version") {
                                Task {
                                    do { try await model.reviewServerVersion(edit) }
                                    catch { self.error = error.localizedDescription }
                                }
                            }
                        }
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("Task")
            .toolbar { Button("Edit") { editing = true }.disabled(model.pendingEdit(for: task).map { $0.attempted && (!$0.blocked || $0.serverTask == nil) } ?? false) }
            .sheet(isPresented: $editing) { TaskEditView(model: model, initial: task) }
        }
    }

    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { self.error = error.localizedDescription }
    }
}

private struct TaskEditView: View {
    @ObservedObject var model: OfflineModel
    @State var task: OfflineTask
    @State private var due: String
    @State private var notes: String
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    init(model: OfflineModel, initial: OfflineTask) {
        self.model = model
        _task = State(initialValue: initial)
        _due = State(initialValue: initial.due_date ?? "")
        _notes = State(initialValue: initial.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $task.title, axis: .vertical)
                    .accessibilityLabel("Title").accessibilityIdentifier("offlineTaskTitle")
                TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...10)
                    .accessibilityLabel("Notes")
                TextField("Due date (YYYY-MM-DD or empty)", text: $due).autocorrectionDisabled()
                Picker("Priority", selection: $task.priority) { ForEach(1...4, id: \.self) { Text(String($0)).tag($0) } }
                if let statuses = model.snapshot?.workflow(for: task)?.definition?.statuses {
                    Picker("Status", selection: Binding(get: { task.workflow_status_id ?? statuses.first(where: { $0.category == task.status })?.id ?? "" }, set: { id in
                        task.workflow_status_id = id
                        if let selected = statuses.first(where: { $0.id == id }) { task.status = selected.category }
                    })) { ForEach(statuses, id: \.id) { Text($0.label).tag($0.id) } }
                } else {
                    Picker("Status", selection: $task.status) {
                        Text("Open").tag("open"); Text("Waiting").tag("waiting"); Text("Done").tag("done")
                    }
                }
                Text("Changes are saved on this phone first. If the task changes on the server, you can review both versions before choosing what to keep.").font(.caption)
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("Edit task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let formatter = DateFormatter()
                        formatter.dateFormat = "yyyy-MM-dd"
                        formatter.locale = Locale(identifier: "en_US_POSIX")
                        formatter.isLenient = false
                        if !due.isEmpty, formatter.date(from: due).map({ formatter.string(from: $0) }) != due {
                            error = "Enter a date as YYYY-MM-DD, or clear it."
                            return
                        }
                        task.due_date = due.isEmpty ? nil : due
                        task.notes = notes.isEmpty ? nil : notes
                        do { try model.saveEdit(task); dismiss() } catch { self.error = error.localizedDescription }
                    }.disabled(task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
