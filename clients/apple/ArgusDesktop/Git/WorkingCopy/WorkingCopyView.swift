import ArgusCore
import ArgusUI
import GroveKit
import SwiftUI

/// The working copy: the commit composer over the changed files, beside the
/// selected file's diff, under the in-progress operation's banner.
struct WorkingCopyView: View {
  let workspace: GitWorkspace
  /// File history lives in the history view; nil hides the menu item.
  var onShowFileHistory: ((String) -> Void)? = nil

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  var body: some View {
    VStack(spacing: 12) {
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
        OperationBanner(workspace: workspace).panel()
      }
      // Grove's Changes tab: the composer over the files, beside the diff, each a card.
      ResizableHSplit(
        key: "git.changes", leadingMin: 260, leadingIdeal: 360, leadingMax: 560, trailingMin: 280, gap: 12
      ) {
        VStack(spacing: 12) {
          CommitComposerView(workspace: workspace).card(padding: 0)
          ChangesListView(workspace: workspace, onShowFileHistory: onShowFileHistory)
            .frame(maxHeight: .infinity)
            .panel()
        }
      } trailing: {
        WorkingDiffView(workspace: workspace).panel()
      }
    }
    .modifier(WorkingCopyDialogs(workspace: workspace))
  }
}
