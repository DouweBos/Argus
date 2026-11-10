import ArgusCore
import ArgusKit
import SwiftUI

/// Which setup step is running and on what, from the host's
/// `session:setup_progress` broadcasts, which carry more than the listed count.
public struct SetupProgressCard: View {
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  let session: RemoteSession
  @State private var step: Step?

  public init(session: RemoteSession) {
    self.session = session
  }

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

  public var body: some View {
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
