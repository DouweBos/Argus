import ArgusKit
import SwiftUI

/// Why a session's setup failed, with the desktop's two ways out: run setup
/// again, or mark it ready once the failing step was fixed by hand.
struct SetupFailedRow: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  let session: RemoteSession

  @State private var expanded = false
  @State private var busy = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Setup failed", systemImage: Icon.warning)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(theme.error)
      if let message = session.setupError, !message.isEmpty {
        // The cause is at the end; the start is usually checkout progress.
        Text(message)
          .font(.caption.monospaced())
          .foregroundStyle(.secondary)
          .lineLimit(expanded ? nil : 4)
          .truncationMode(.head)
          .textSelection(.enabled)
          .onTapGesture { expanded.toggle() }
      }
      if app.hasControl {
        FlowRow(spacing: 8) {
          Btn(label: "Retry", small: true, icon: Icon.refresh) {
            run { await app.retrySessionSetup(id: session.id, repoRoot: session.repoRoot) }
          }
          Btn(label: "Mark as ready", tone: .secondary, small: true, icon: Icon.check) {
            run { await app.markSessionReady(id: session.id, repoRoot: session.repoRoot) }
          }
        }
        .disabled(busy)
      }
    }
    .padding(.vertical, 4)
  }

  private func run(_ action: @escaping () async -> Void) {
    busy = true
    Task {
      await action()
      busy = false
    }
  }
}
