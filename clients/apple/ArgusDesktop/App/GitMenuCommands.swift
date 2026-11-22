import ArgusKit
import SwiftUI

/// The Git menu. `ShortcutRouter` takes the keys; an item only shows the one it would get.
struct GitMenuCommands: View {
  let model: DesktopModel

  var body: some View {
    let session = KeyWindow.shared.takesCommands ? model.gitSession : nil
    let features = session.map(model.gitFeatures) ?? []
    item(.fetch, session, features)
    item(.pull, session, features)
    item(.push, session, features)
    Divider()
    item(.branch, session, features)
    Divider()
    item(.merge, session, features)
    item(.rebase, session, features)
    item(.createPullRequest, session, features)
    Divider()
    item(.commit, session, features)
    item(.stash, session, features)
    item(.snapshot, session, features)
    Divider()
    item(.undo, session, features)
  }

  private func item(_ action: GitMenuAction, _ session: RemoteSession?, _ features: Set<GitFeature>) -> some View {
    let refusal = session.flatMap { self.refusal(action, $0, features) }
    let bound = action.chord.flatMap { model.binds($0, to: .git(action)) ? $0.keyboardShortcut : nil }
    return Button {
      MenuCommand.git(action).run(model)
    } label: {
      Text(action.title(features))
      // A second text is the menu item's subtitle.
      if let refusal, refusal.kind == .unsupported { Text(refusal.message) }
    }
    .keyboardShortcut(bound)
    .disabled(session == nil || refusal != nil)
  }

  /// State only counts while the repository is watched; otherwise the command reads it and says.
  private func refusal(_ action: GitMenuAction, _ session: RemoteSession, _ features: Set<GitFeature>) -> GitRefusal? {
    if let refusal = action.refusal(features: features) { return refusal }
    guard let workspace = model.git.workspace(session.id), workspace.isActive, workspace.refs.hasLoaded else {
      return nil
    }
    return action.refusal(in: workspace)
  }
}
