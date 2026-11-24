import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// The reflog from GroveUIKit; New Branch at an entry runs through the host like the toolbar's.
struct ReflogView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let session: RemoteSession

  var body: some View {
    GitReflogView(
      viewModel: workspace.reflog,
      dialogs: RefActions(workspace: workspace, session: session, model: model).dialogContext,
      presenter: model.gitDialogs, options: DiffViewSettings.shared.options
    )
    .gitPanelPadding()
    .gitFeatures(workspace.features)
    .gitUIHost(.argus(openLine: nil))
  }
}
