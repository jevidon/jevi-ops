import SwiftUI

/// The Search tab: instant results from what the phone holds (tasks,
/// projects, domains, captures), then the server's cross-library search
/// (notes, quotes, content, books, people) when it answers.
struct SearchView: View {
    @ObservedObject var model: OfflineModel
    var onWeb: (String) -> Void
    @State private var query = ""
    @State private var remote: RemoteResults?
    @State private var remoteError: String?
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    struct RemoteHit: Decodable, Identifiable { var id: String; var title: String?; var name: String?; var body: String?; var text: String?
        var label: String { title ?? name ?? String((body ?? text ?? "").prefix(80)) } }
    struct RemoteResults: Decodable {
        var notes: [RemoteHit] = []; var quotes: [RemoteHit] = []; var content: [RemoteHit] = []
        var books: [RemoteHit] = []; var people: [RemoteHit] = []
    }

    private var q: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ScreenHeader(eyebrow: "Everything", title: "Search")
                    EditorialField(placeholder: "Tasks, projects, domains, notes, people…", text: $query)
                        .focused($focused)
                        .padding(.horizontal, 20)
                        .accessibilityIdentifier("searchField")
                    if q.count < 2 {
                        Notice(text: "Type at least two characters. Saved tasks, projects and domains answer instantly, even offline.")
                            .padding(.top, 8)
                    } else {
                        let tasks = model.visibleTasks.filter { hit($0.title) || hit($0.notes) }
                        let projects = (model.snapshot?.projects ?? []).filter { hit($0.name) }
                        let domains = (model.snapshot?.domains ?? []).filter { hit($0.name) }
                        let captures = model.captures.filter { hit($0.text) }
                        let localTotal = tasks.count + projects.count + domains.count + captures.count
                        Text("\(localTotal + (remote?.total ?? 0)) results on this phone\(remote != nil ? " and the server" : "")")
                            .font(Typeface.mono(11)).foregroundStyle(Theme.ink3).padding(.horizontal, 20).padding(.top, 12)
                        VStack(alignment: .leading, spacing: 0) {
                            if !tasks.isEmpty {
                                SectionEyebrow(title: "Tasks", count: tasks.count)
                                ForEach(tasks.prefix(30)) { task in TaskRowLink(model: model, task: task) }
                            }
                            if !projects.isEmpty {
                                SectionEyebrow(title: "Projects & areas", count: projects.count)
                                ForEach(projects) { project in
                                    NavigationLink(value: DomainRoute.project(project.id)) {
                                        resultRow(project.name, sub: model.snapshot?.domain(project.domain_id)?.name ?? "Unassigned")
                                    }.buttonStyle(.plain)
                                }
                            }
                            if !domains.isEmpty {
                                SectionEyebrow(title: "Domains", count: domains.count)
                                ForEach(domains) { domain in
                                    NavigationLink(value: DomainRoute.domain(domain.id)) { resultRow(domain.name, sub: "Domain") }.buttonStyle(.plain)
                                }
                            }
                            if !captures.isEmpty {
                                SectionEyebrow(title: "Saved captures", count: captures.count)
                                ForEach(captures.prefix(20)) { capture in
                                    NavigationLink { CaptureDetailView(model: model, id: capture.id) } label: {
                                        resultRow(capture.title, sub: capture.createdAt.formatted(date: .abbreviated, time: .omitted))
                                    }.buttonStyle(.plain)
                                }
                            }
                            if let remote {
                                remoteSection("Notes", remote.notes) { "/library/notes/\($0.id)" }
                                remoteSection("Quotes", remote.quotes) { "/library/quotes/\($0.id)" }
                                remoteSection("Content", remote.content) { "/content/\($0.id)" }
                                remoteSection("Books", remote.books) { "/library/books/\($0.id)" }
                                remoteSection("People", remote.people) { "/people/\($0.id)" }
                            } else if let remoteError {
                                Notice(text: remoteError).padding(.horizontal, -20).padding(.top, 16)
                            }
                            if localTotal == 0, remote?.total ?? 0 == 0 {
                                EmptyNote(text: "Nothing matches on this phone.").padding(.top, 16)
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }
                .padding(.bottom, 40)
            }
            .background(Theme.bg)
            .navigationDestination(for: DomainRoute.self) { route in
                switch route {
                case .domain(let id): DomainDetailView(model: model, domainID: id, onCompose: { _ in }, onWeb: onWeb)
                case .project(let id): ProjectDetailView(model: model, projectID: id, onCompose: { _ in }, onWeb: onWeb)
                case .task(let id): TaskDetailView(model: model, taskID: id, onWeb: onWeb)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .onAppear { focused = true }
        .onChange(of: query) { _, _ in scheduleRemote() }
    }

    private func hit(_ text: String?) -> Bool { text?.localizedCaseInsensitiveContains(q) ?? false }

    private func resultRow(_ title: String, sub: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Typeface.sans(14)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                Text(sub.uppercased()).font(Typeface.mono(10)).tracking(0.8).foregroundStyle(Theme.ink3)
            }
            Spacer()
            Icon(name: .chev, size: 14, color: Theme.ink4)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) { Hairline() }
    }

    @ViewBuilder
    private func remoteSection(_ title: String, _ hits: [RemoteHit], path: @escaping (RemoteHit) -> String) -> some View {
        if !hits.isEmpty {
            SectionEyebrow(title: title, count: hits.count)
            ForEach(hits) { hit in
                Button { onWeb(path(hit)) } label: { resultRow(hit.label, sub: "On the web") }.buttonStyle(.plain)
            }
        }
    }

    private func scheduleRemote() {
        searchTask?.cancel()
        remote = nil
        remoteError = nil
        guard q.count >= 2, model.networkAvailable, let client = APIClient.forDevice, client.bearer != nil else { return }
        #if DEBUG
        if OfflineFixture.isActive { return }
        #endif
        let term = q
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            do {
                let encoded = term.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? term
                let results: RemoteResults = try await client.send("GET", "/api/search?q=\(encoded)")
                if !Task.isCancelled { remote = results }
            } catch {
                if !Task.isCancelled { remoteError = "Server search unavailable. Showing what is saved on this phone." }
            }
        }
    }
}

extension SearchView.RemoteResults {
    var total: Int { notes.count + quotes.count + content.count + books.count + people.count }
}
