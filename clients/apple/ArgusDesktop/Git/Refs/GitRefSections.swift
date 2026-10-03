import ArgusUI
import GroveKit
import SwiftUI

/// The project's branches, tags, remotes, submodules and worktrees in the git sidebar.
struct GitRefSections: View {
  let workspace: GitWorkspace
  let session: RemoteSession
  let view: GitRoute

  var body: some View {
    EmptyView()
  }
}
