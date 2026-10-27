import ArgusCore
import ArgusUI
import SwiftUI

/// A session still being set up (or torn down), or one whose setup failed.
struct SessionSetupView: View {
  let session: RemoteSession
  /// The listed session's progress, refreshed on each `session:progress`.
  let progress: RemoteSessionProgress?

  var body: some View {
    VStack(spacing: 16) {
      switch session.status {
      case .error:
        SetupFailedRow(session: session).frame(maxWidth: 520)
      case .deleting:
        progress("Deleting the worktree…")
      case .initializing:
        SetupProgressCard(session: session).frame(maxWidth: 520)
      default:
        progress("Setting up the worktree…")
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  @ViewBuilder
  private func progress(_ title: String) -> some View {
    Text(title).foregroundStyle(.secondary)
    if let fraction = progress?.fraction {
      ProgressView(value: fraction).frame(maxWidth: 320)
    } else {
      ProgressView()
    }
  }
}

/// Which setup step is running and on what, from the host's
/// `session:setup_progress` broadcasts, which carry more than the listed count.
struct SetupProgressCard: View {
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  let session: RemoteSession
  @State private var step: Step?

  struct Step: Decodable {
    let current: Double
    let total: Double
    let item: String
    let phase: String?
    let detail: String?
  }

  private static let phaseLabels = [
    "matching": "Matching files", "copy": "Copying", "symlink": "Linking",
    "command": "Running setup commands",
  ]

  var body: some View {
    Card {
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text(step.flatMap { $0.phase.flatMap { Self.phaseLabels[$0] } } ?? "Initializing session")
          .font(.scaled(.headline))
        Spacer()
        Text(stepLine).font(.scaled(.caption)).foregroundStyle(.secondary)
      }
      if let fraction = fraction {
        ProgressView(value: fraction)
      } else {
        ProgressView().progressViewStyle(.linear)
      }
      if let step {
        Text(step.item).font(.scaled(.caption).monospaced()).foregroundStyle(.secondary).lineLimit(1)
          .truncationMode(.middle)
        if let detail = step.detail {
          Text(detail).font(.scaled(.caption).monospaced()).foregroundStyle(.secondary).lineLimit(1)
            .truncationMode(.middle)
        }
      }
    }
    .task(id: session.id) {
      let channel = "session:setup_progress:\(session.id)"
      let stop = store.observeIpc { name, args, _ in
        guard name == channel, let arg = args.first,
          let next = try? ProtocolCodec.convert(arg, to: Step.self)
        else { return }
        step = next
      }
      // Hold the observer for as long as the card is up.
      while !Task.isCancelled { try? await Task.sleep(for: .seconds(3600)) }
      stop()
    }
  }

  private var fraction: Double? {
    if let step, step.total > 0 { return min(max(step.current / step.total, 0), 1) }
    return session.progress?.fraction
  }

  private var stepLine: String {
    guard let step, step.total > 0 else { return "Preparing the worktree…" }
    return "Step \(Int(step.current)) of \(Int(step.total)) · \(max(Int(step.total - step.current), 0)) remaining"
  }
}
