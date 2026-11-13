import ArgusCore
import SwiftUI

/// Why a session's setup or delete failed, with the ways out: run setup again
/// or mark it ready; retry the delete, or after a failed teardown delete anyway.
public struct SetupFailedRow: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let session: RemoteSession

  @State private var expanded = false
  @State private var busy = false

  public init(session: RemoteSession) {
    self.session = session
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label(title, systemImage: Icon.warning)
        .font(.scaled(.subheadline).weight(.semibold))
        .foregroundStyle(theme.error)
      if let message = session.setupError, !message.isEmpty {
        // The cause is at the end; the start is usually checkout progress.
        Text(message)
          .font(.scaled(.caption).monospaced())
          .foregroundStyle(.secondary)
          .lineLimit(expanded ? nil : 4)
          .truncationMode(.head)
          .textSelection(.enabled)
          .onTapGesture { expanded.toggle() }
      }
      if host.hasControl {
        FlowRow(spacing: 8) {
          if session.deleteFailed != nil {
            Btn(label: "Retry", small: true, icon: Icon.refresh) {
              run { await host.deleteSession(id: session.id, repoRoot: session.repoRoot, deleteBranch: nil) }
            }
            if session.deleteFailed == .teardown {
              Btn(label: "Delete anyway", tone: .danger, small: true, icon: Icon.trash) {
                run {
                  await host.deleteSession(
                    id: session.id, repoRoot: session.repoRoot, deleteBranch: nil, skipTeardown: true)
                }
              }
            }
          } else {
            Btn(label: "Retry", small: true, icon: Icon.refresh) {
              run { await host.retrySessionSetup(id: session.id, repoRoot: session.repoRoot) }
            }
            Btn(label: "Mark as ready", tone: .secondary, small: true, icon: Icon.check) {
              run { await host.markSessionReady(id: session.id, repoRoot: session.repoRoot) }
            }
          }
        }
        .disabled(busy)
      }
    }
    .padding(.vertical, 4)
  }

  private var title: String {
    switch session.deleteFailed {
    case .teardown: "Teardown failed"
    case .remove: "Delete failed"
    case nil: "Setup failed"
    }
  }

  private func run(_ action: @escaping () async -> Void) {
    busy = true
    Task {
      await action()
      busy = false
    }
  }
}
