import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// The in-progress operation's conflicted files, each resolved by taking a side or editing the merged result.
struct ConflictsView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let session: RemoteSession

  var body: some View {
    VStack(spacing: 0) {
      WorkingCopyErrorBanner(workspace: workspace)
      GitConflictsView(viewModel: workspace.workingCopy, host: .argus(workspace: workspace, session: session, model: model)) {
        model.navigate(.sessionGit(id: workspace.sessionId, view: .working))
      }
      .padding([.horizontal, .bottom], 12)
      .padding(.top, 10)
    }
    .gitFeatures(workspace.features)
  }
}
