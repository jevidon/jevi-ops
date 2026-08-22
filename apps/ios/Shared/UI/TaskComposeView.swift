import SwiftUI

/// Quick task capture, used by the share extension (and later by the in-app
/// quick-add sheet). Mirrors the web's QuickAddTask convention: exactly one
/// of project_id/domain_id goes to POST /api/tasks — or neither, which the
/// server files to Inbox.
struct TaskComposeView: View {
    enum TargetKind: String, CaseIterable, Identifiable {
        case inbox = "Inbox"
        case domain = "Domain"
        case project = "Project"
        var id: String { rawValue }
    }

    let sharedURL: URL?
    var onFinish: (_ saved: Bool) -> Void

    @State private var title: String
    @State private var notes: String
    @State private var kind: TargetKind = .inbox
    @State private var selectedDomain: Domain?
    @State private var selectedProject: Project?
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var offerQueue = false
    @State private var refs = ReferenceCache.load()

    private var linked: Bool { KeychainStore.deviceToken != nil }

    init(initialTitle: String, initialNotes: String = "", sharedURL: URL?, onFinish: @escaping (_ saved: Bool) -> Void) {
        self.sharedURL = sharedURL
        self.onFinish = onFinish
        _title = State(initialValue: initialTitle)
        _notes = State(initialValue: initialNotes)
    }

    var body: some View {
        NavigationStack {
            Form {
                if !linked {
                    Section {
                        Text("Link this device first — open Jevi Ops, shake for Settings, and choose Link device.")
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Task") {
                    TextField("Title", text: $title, axis: .vertical)
                        .lineLimit(1...3)
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(2...6)
                    if let sharedURL {
                        Label {
                            Text(sharedURL.absoluteString)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        } icon: {
                            Image(systemName: "link")
                        }
                    }
                }

                Section("File to") {
                    Picker("Target", selection: $kind) {
                        ForEach(TargetKind.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    switch kind {
                    case .inbox:
                        EmptyView()
                    case .domain:
                        if let domains = refs?.domains, !domains.isEmpty {
                            Picker("Domain", selection: $selectedDomain) {
                                Text("Choose…").tag(Domain?.none)
                                ForEach(domains) { Text($0.name).tag(Optional($0)) }
                            }
                        } else {
                            cacheEmptyHint
                        }
                    case .project:
                        if let projects = refs?.projects, !projects.isEmpty {
                            Picker("Project", selection: $selectedProject) {
                                Text("Choose…").tag(Project?.none)
                                ForEach(projects) { Text($0.name).tag(Optional($0)) }
                            }
                        } else {
                            cacheEmptyHint
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.callout)
                    }
                }
            }
            .navigationTitle("New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onFinish(false) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(!canSave)
                    }
                }
            }
        }
        .task {
            // Opportunistic freshen; offline just keeps last-known-good.
            await ReferenceCache.refresh()
            refs = ReferenceCache.load()
        }
        .alert("Can't reach the server", isPresented: $offerQueue) {
            Button("Save for later") {
                PendingQueue.append(buildPayload())
                onFinish(true)
            }
            Button("Retry") { Task { await save() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Saved tasks are sent the next time you open Jevi Ops on the tailnet.")
        }
    }

    private var cacheEmptyHint: some View {
        Text("Nothing cached yet — open Jevi Ops once while online.")
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    private var canSave: Bool {
        guard linked, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        switch kind {
        case .inbox: return true
        case .domain: return selectedDomain != nil
        case .project: return selectedProject != nil
        }
    }

    private func buildPayload() -> CreateTaskPayload {
        var mergedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if let sharedURL {
            mergedNotes = mergedNotes.isEmpty
                ? sharedURL.absoluteString
                : mergedNotes + "\n\n" + sharedURL.absoluteString
        }
        return CreateTaskPayload(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            notes: mergedNotes.isEmpty ? nil : mergedNotes,
            project_id: kind == .project ? selectedProject?.id : nil,
            domain_id: kind == .domain ? selectedDomain?.id : nil
        )
    }

    private func save() async {
        guard let client = APIClient.forDevice, client.bearer != nil else {
            errorMessage = "No device token — link this device in the Jevi Ops app."
            return
        }
        saving = true
        errorMessage = nil
        defer { saving = false }

        do {
            try await client.createTask(buildPayload())
            onFinish(true)
        } catch APIError.network {
            offerQueue = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
