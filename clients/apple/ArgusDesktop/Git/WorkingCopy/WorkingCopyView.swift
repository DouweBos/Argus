import ArgusUI
import GroveKit
import SwiftUI

/// The working copy: changes and the commit composer beside the selected
/// file's diff, under the in-progress operation's banner.
struct WorkingCopyView: View {
  let workspace: GitWorkspace
  /// File history lives in the history view; nil hides the menu item.
  var onShowFileHistory: ((String) -> Void)? = nil
  @State private var pendingDiscardAction: HunkAction?

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  var body: some View {
    VStack(spacing: 0) {
      if let error = vm.errorMessage {
        GitErrorBanner(message: error) { vm.clearError() }
      }
      if vm.isInOperation {
        OperationBanner(workspace: workspace)
        Divider()
      }
      HSplitView {
        VStack(spacing: 0) {
          ChangesListView(workspace: workspace, onShowFileHistory: onShowFileHistory)
            .frame(maxHeight: .infinity)
          Divider()
          CommitComposerView(workspace: workspace)
        }
        .frame(minWidth: 240, idealWidth: 320, maxWidth: 560)
        WorkingDiffView(workspace: workspace, pendingDiscardAction: $pendingDiscardAction)
          .frame(minWidth: 320, maxWidth: .infinity)
      }
    }
    .modifier(WorkingCopyDialogs(workspace: workspace, pendingDiscardAction: $pendingDiscardAction))
  }
}
