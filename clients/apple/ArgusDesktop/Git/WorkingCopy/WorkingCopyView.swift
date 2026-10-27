import ArgusCore
import ArgusUI
import GroveKit
import SwiftUI

/// The working copy: the commit composer over the changed files, beside the
/// selected file's diff, under the in-progress operation's banner.
struct WorkingCopyView: View {
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  /// File history lives in the history view; nil hides the menu item.
  var onShowFileHistory: ((String) -> Void)? = nil

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  var body: some View {
    VStack(spacing: 0) {
      if let error = vm.errorMessage {
        let typed = workspace.isRemote ? RemoteGitFailures.shared.recent(sessionId: workspace.sessionId) : nil
        GitFailureBanner(
          workspace: workspace, session: nil,
          failure: typed.map { GitFailure(kind: $0.kind, message: error, recovery: $0.recovery, details: $0.details) }
            ?? GitFailure.classify(error),
          canRetry: false
        ) { vm.clearError() }
      }
      if vm.isInOperation {
        OperationBanner(workspace: workspace)
        Rectangle().fill(theme.border).frame(height: 1)
      }
      // The composer over the files, beside the diff, split by hairlines.
      ResizableHSplit(key: "git.changes", leadingMin: 260, leadingIdeal: 360, leadingMax: 560, trailingMin: 280) {
        VStack(spacing: 0) {
          CommitComposerView(workspace: workspace)
          Rectangle().fill(theme.border).frame(height: 1)
          ChangesListView(workspace: workspace, onShowFileHistory: onShowFileHistory)
            .frame(maxHeight: .infinity)
        }
      } trailing: {
        WorkingDiffView(workspace: workspace)
      }
    }
    .modifier(WorkingCopyDialogs(workspace: workspace))
  }
}
