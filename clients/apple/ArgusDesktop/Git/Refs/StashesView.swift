import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// Stashes from GroveUIKit; its dialogs run through the host like the toolbar's, and Reveal Base opens History.
struct StashesView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let session: RemoteSession

  var body: some View {
    GitStashesView(
      viewModel: workspace.stashes,
      dialogs: RefActions(workspace: workspace, session: session, model: model).dialogContext,
      presenter: model.gitDialogs, options: DiffViewSettings.shared.options,
      hasChanges: workspace.workingCopy.changedCount > 0
    )
    .gitPanelPadding()
    .gitFeatures(workspace.features)
    .gitUIHost(.argus(openLine: nil))
    .task {
      let sessionId = workspace.sessionId
      let isProjectRoot = workspace.isProjectRoot
      // The history model doesn't hold the stashes one, so capturing it keeps no cycle.
      workspace.stashes.onRevealInHistory = { [history = workspace.history, model] sha in
        model.navigate(.sessionGit(id: sessionId, view: isProjectRoot ? .history : .branch))
        Task { await history.reveal(sha) }
      }
    }
  }
}
