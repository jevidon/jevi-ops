import SwiftUI
import AVKit

enum CaptureMode { case menu, record }

/// The Capture Portal (CapturePortal.tsx) as a native sheet: the "create
/// anything" grid, a hairline, the free-text box, then the voice row. Text and
/// audio are saved on the phone first and delivered when the server answers.
struct CaptureSheet: View {
    @ObservedObject var model: OfflineModel
    var mode: CaptureMode
    var onOpenWeb: (String) -> Void
    var onNewTask: () -> Void
    @State private var text = ""
    @State private var message: String?
    @State private var starting = false
    @State private var elapsed = 0
    @State private var recordingStarted: Date?
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    private let types: [(label: String, path: String?, icon: IconName)] = [
        ("Task", nil, .tasks), ("Project", "/projects/new", .work), ("Area", "/projects/new?kind=area", .area),
        ("Domain", "/domains/new", .domains), ("Person", "/people/new", .people), ("Company", "/companies/new", .companies),
        ("Content", "/content/new", .content), ("Routine", "/routines/new", .routines), ("Book", "/library/books/new", .library),
        ("Note", "/library/notes/new", .note), ("Quote", "/library/quotes/new", .quote), ("Journal", "/library/journal/new", .journal),
    ]

    var body: some View {
        VStack(spacing: 0) {
            Capsule().fill(Theme.lineStrong).frame(width: 36, height: 4).padding(.top, 10).padding(.bottom, 4)
            HStack {
                Eyebrow(text: "Capture")
                Spacer()
                Button("Close") { dismiss() }
                    .font(Typeface.mono(10)).tracking(0.8).textCase(.uppercase).foregroundStyle(Theme.ink3)
            }
            .padding(.horizontal, 20).padding(.bottom, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        ForEach(types, id: \.label) { type in
                            Button {
                                if let path = type.path { onOpenWeb(path) } else { onNewTask() }
                            } label: {
                                VStack(spacing: 6) {
                                    Icon(name: type.icon, size: 20, color: Theme.ink2)
                                    Text(type.label).font(Typeface.sans(12, .medium)).foregroundStyle(Theme.ink2)
                                }
                                .frame(maxWidth: .infinity).padding(.vertical, 12)
                                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.line, lineWidth: 1))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Hairline()
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Capture anything — a thought, a task, a note…", text: $text, axis: .vertical)
                            .lineLimit(3...8).font(Typeface.sans(15)).focused($focused).bordered()
                            .disabled(model.recordingID != nil)
                            .accessibilityIdentifier("offlineNote")
                        HStack {
                            Text("Saves on this phone immediately, airplane mode included. Delivery follows when the server is reachable.")
                                .font(Typeface.sans(11)).foregroundStyle(Theme.ink3)
                            Spacer()
                            ActionButton(label: "Save", variant: .solid) { save() }
                                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.recordingID != nil)
                        }
                        if let message { ResultChip(text: message) }
                    }
                    Hairline()
                    voiceRow
                    if let error = model.storageError { Notice(text: error, tone: .error).padding(.horizontal, -20) }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
        }
        .background(Theme.bg)
        .onAppear {
            if mode == .menu { focused = true }
        }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in
            if let started = recordingStarted, model.recordingID != nil { elapsed = Int(Date().timeIntervalSince(started)) }
        }
        .onChange(of: model.recordingID) { _, id in
            recordingStarted = id == nil ? nil : Date()
            if id == nil { elapsed = 0 }
        }
    }

    private var voiceRow: some View {
        HStack(spacing: 12) {
            if model.recordingID != nil {
                Circle().fill(Theme.accent).frame(width: 8, height: 8)
                Text("Listening").font(Typeface.sans(14, .medium)).foregroundStyle(Theme.ink)
                Text(formatElapsed(elapsed)).font(Typeface.mono(12)).foregroundStyle(Theme.ink3)
                Spacer()
                ActionButton(label: "Stop & save", variant: .solid) { model.stopRecording() }
            } else {
                Icon(name: .mic, size: 20, color: Theme.ink2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(starting ? "Opening microphone…" : "Speak it instead").font(Typeface.sans(14, .medium)).foregroundStyle(Theme.ink)
                    Text("Up to 10 minutes. Audio stays on this phone for playback; transcription happens on the server.")
                        .font(Typeface.sans(11)).foregroundStyle(Theme.ink3)
                }
                Spacer()
                ActionButton(label: "Record", variant: .ghost) {
                    focused = false
                    starting = true
                    Task {
                        defer { starting = false }
                        do { try await model.startRecording(note: text) ; text = "" }
                        catch { message = error.localizedDescription }
                    }
                }
                .disabled(starting)
            }
            if let note = model.recordingMessage, model.recordingID == nil { Text(note).font(Typeface.sans(11)).foregroundStyle(Theme.ink3) }
        }
    }

    private func save() {
        do {
            try model.saveNote(text)
            text = ""
            focused = false
            message = "Saved on this phone."
        } catch { message = error.localizedDescription }
    }
}

struct ResultChip: View {
    var text: String
    var body: some View {
        HStack(spacing: 6) {
            Icon(name: .check, size: 12, color: Theme.good)
            Text(text).font(Typeface.mono(10, .semibold)).tracking(0.5).foregroundStyle(Theme.good)
        }
        .padding(.horizontal, 10).frame(height: 24)
        .background(Theme.goodSoft, in: Capsule())
        .overlay(Capsule().stroke(Theme.goodLine, lineWidth: 1))
        .accessibilityIdentifier("captureMessage")
    }
}

/// Everything captured on this phone: searchable, playable, with delivery
/// state. Delivered originals stay here on purpose.
struct CaptureLibraryView: View {
    @ObservedObject var model: OfflineModel
    @State private var search = ""
    @Environment(\.dismiss) private var dismiss

    private var filtered: [LocalCapture] {
        model.captures.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) || $0.text.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ScreenHeader(eyebrow: "This phone", title: "Saved captures", meta: model.captures.isEmpty ? nil : "\(model.captures.count) saved")
                EditorialField(placeholder: "Search saved captures", text: $search).padding(.horizontal, 20).padding(.bottom, 12)
                if !model.networkAvailable { Notice(text: "Offline · everything here is saved on this phone") }
                if let message = model.connectionMessage { Notice(text: message) }
                if let error = model.storageError { Notice(text: error, tone: .error) }
                if model.captures.isEmpty { Notice(text: "Your saved notes and recordings will appear here, even offline.") }
                VStack(spacing: 0) {
                    ForEach(filtered) { capture in
                        NavigationLink { CaptureDetailView(model: model, id: capture.id) } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Icon(name: capture.hasRecording ? .mic : .note, size: 18, color: Theme.ink3).padding(.top, 2)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(capture.title).font(Typeface.sans(14)).foregroundStyle(Theme.ink).lineLimit(2).multilineTextAlignment(.leading)
                                    Text(capture.createdAt.formatted(date: .abbreviated, time: .shortened)).font(Typeface.mono(10)).foregroundStyle(Theme.ink3)
                                    Text(status(capture).uppercased()).font(Typeface.mono(10)).tracking(0.8)
                                        .foregroundStyle(capture.blocked ? Theme.warn : Theme.ink3)
                                }
                                Spacer()
                                Icon(name: .chev, size: 14, color: Theme.ink4)
                            }
                            .padding(.horizontal, 20).padding(.vertical, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .bottom) { Hairline().padding(.horizontal, 20) }
                    }
                }
            }
            .padding(.bottom, 32)
        }
        .background(Theme.bg)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.surface, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(model.syncing ? "Syncing…" : "Sync") { Task { await model.sendPending(retryBlocked: true) } }.disabled(model.syncing)
            }
        }
    }

    private func status(_ capture: LocalCapture) -> String {
        if capture.deliveredAt != nil { return "Delivered · saved on phone" }
        if !capture.ready { return "Recording needs recovery" }
        return capture.blocked ? "Needs attention" : "Saved on phone · pending delivery"
    }
}

struct CaptureDetailView: View {
    @ObservedObject var model: OfflineModel
    let id: UUID
    @State private var player: AVPlayer?
    @State private var error: String?

    var body: some View {
        if let capture = model.captures.first(where: { $0.id == id }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenHeader(eyebrow: capture.hasRecording ? "Voice note" : "Note", title: capture.title,
                                 meta: capture.createdAt.formatted(date: .abbreviated, time: .shortened))
                        .padding(.horizontal, -20)
                    if !capture.text.isEmpty {
                        Text(capture.text).font(Typeface.sans(15)).foregroundStyle(Theme.ink).lineSpacing(3).textSelection(.enabled)
                    }
                    if capture.hasRecording, let url = model.store?.recordingURL(id) {
                        HStack(spacing: 8) {
                            ActionButton(label: "Play", variant: .solid) {
                                do {
                                    try AVAudioSession.sharedInstance().setCategory(.playback)
                                    player = AVPlayer(url: url); player?.play()
                                } catch { self.error = error.localizedDescription }
                            }
                            .disabled(model.recordingID != nil)
                            ActionButton(label: "Stop", variant: .ghost) { player?.pause() }
                            ShareLink(item: url) { Text("EXPORT").font(Typeface.mono(10, .semibold)).tracking(0.7).foregroundStyle(Theme.ink2) }
                        }
                        if !capture.recordingFinished, model.recordingID != id {
                            ActionButton(label: "Recover interrupted recording", variant: .accent) {
                                do { try model.recoverRecording(id) } catch { self.error = error.localizedDescription }
                            }
                        }
                    }
                    Text(capture.deliveredAt != nil ? "Delivered. The original remains on this phone." : "Saved locally. Delivery is pending.")
                        .font(Typeface.mono(10)).tracking(0.5).foregroundStyle(Theme.ink3)
                    if let failure = capture.deliveryError { Text(failure).font(Typeface.sans(12)).foregroundStyle(Theme.warn) }
                    if let error { Text(error).font(Typeface.sans(12)).foregroundStyle(Theme.accent) }
                    if !capture.text.isEmpty {
                        ShareLink(item: capture.text) { Text("EXPORT NOTE").font(Typeface.mono(10, .semibold)).tracking(0.7).foregroundStyle(Theme.ink2) }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
            .background(Theme.bg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.surface, for: .navigationBar)
            .onDisappear { player?.pause() }
        }
    }
}
