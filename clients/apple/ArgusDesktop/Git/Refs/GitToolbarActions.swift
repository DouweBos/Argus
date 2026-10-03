import ArgusUI
import GroveKit
import SwiftUI

/// The git panel's toolbar: fetch, pull, push, branch, stash, tag.
struct GitToolbarActions: ToolbarContent {
  let workspace: GitWorkspace
  let session: RemoteSession

  var body: some ToolbarContent {
    ToolbarItem { EmptyView() }
  }
}
