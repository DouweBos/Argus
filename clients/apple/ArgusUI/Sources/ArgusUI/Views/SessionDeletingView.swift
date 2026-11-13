import ArgusCore
import ArgusKit
import SwiftUI

/// A session being deleted, laid out like `SetupProgressCard`: its teardown
/// commands' latest output while they run, then how much of the worktree is gone.
public struct SessionDeletingView: View {
  let progress: RemoteSessionProgress?

  public init(progress: RemoteSessionProgress?) {
    self.progress = progress
  }

  public var body: some View {
    Card {
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text(teardown ? "Running teardown commands" : "Deleting the worktree").font(.scaled(.headline))
        Spacer()
        Text(stepLine).font(.scaled(.caption)).foregroundStyle(.secondary)
      }
      if let fraction = progress?.fraction {
        ProgressView(value: fraction)
      } else {
        ProgressView().progressViewStyle(.linear)
      }
      if teardown, let detail = progress?.detail, !detail.isEmpty {
        Text(detail).font(.scaled(.caption).monospaced()).foregroundStyle(.secondary).lineLimit(1)
          .truncationMode(.middle)
      }
    }
    .frame(maxWidth: 520)
  }

  private var teardown: Bool { progress?.isTeardown == true }

  private var stepLine: String {
    guard teardown, let progress, progress.total > 0 else { return "Removing files…" }
    return "Command \(Int(progress.current) + 1) of \(Int(progress.total))"
  }
}
