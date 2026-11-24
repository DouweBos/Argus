import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// Branches Review from GroveUIKit: deleting needs the host's `editBranches`, off in a worktree session.
struct BranchesReviewView: View {
  let workspace: GitWorkspace

  var body: some View {
    GitBranchesReviewView(viewModel: workspace.branchesReview)
      .gitPanelPadding()
      .gitFeatures(workspace.features)
      .gitUIHost(.argus(openLine: nil))
  }
}
