import SwiftUI

/// In-app quick add — the same TaskComposeView the share extension uses,
/// reached via the "New Task" quick action or jeviops://new-task.
struct NewTaskSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        TaskComposeView(initialTitle: "", sharedURL: nil) { _ in
            dismiss()
        }
    }
}
