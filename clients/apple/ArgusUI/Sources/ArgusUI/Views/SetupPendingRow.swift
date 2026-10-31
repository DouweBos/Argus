import ArgusCore
import SwiftUI

/// A worktree made outside Argus: offer the project's setup it never got, or
/// to leave it as it is.
public struct SetupPendingRow: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let session: RemoteSession

  @State private var busy = false

  public init(session: RemoteSession) {
    self.session = session
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Setup never ran", systemImage: "info.circle")
        .font(.scaled(.subheadline).weight(.semibold))
      Text("This worktree was made outside Argus, so the project's setup hasn't run in it.")
        .font(.scaled(.caption))
        .foregroundStyle(theme.textSecondary)
      if host.hasControl {
        FlowRow(spacing: 8) {
          Btn(label: "Run setup", small: true, icon: Icon.play) {
            run { await host.retrySessionSetup(id: session.id, repoRoot: session.repoRoot) }
          }
          Btn(label: "Skip", tone: .secondary, small: true) {
            run { await host.markSessionReady(id: session.id, repoRoot: session.repoRoot) }
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
