import ArgusUI
import GroveKit
import SwiftUI

/// The git panel's toolbar: fetch, pull, push, branch, stash, tag.
struct GitToolbarActions: ToolbarContent {
  let workspace: GitWorkspace
  let session: RemoteSession

  var body: some ToolbarContent {
    ToolbarItem {
      GitToolbarButtons(workspace: workspace, session: session)
    }
  }
}

/// A worktree session gets Electron's `scope === "session"` subset: no tags,
/// and Branch renames the session's branch instead of creating one.
private struct GitToolbarButtons: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let session: RemoteSession

  var body: some View {
    PillActionGroup(actions: items) {
      if let label = workspace.hostBusy {
        ProgressView().controlSize(.small).frame(width: 30).help(label).accessibilityLabel(label)
      }
    }
  }

  private var items: [PillAction] {
    let actions = RefActions(workspace: workspace, session: session, model: model, theme: theme)
    let undo = workspace.undo
    let busy = workspace.hostBusy != nil
    let current = actions.currentBranch
    let noRemotes = workspace.refs.remotes.isEmpty
    var items = [
      PillAction(id: "fetch", title: "Fetch", symbol: "arrow.down.circle", help: "Fetch from all remotes", disabled: busy) {
        Task { await actions.fetch() }
      },
      PillAction(id: "pull", title: "Pull", symbol: "arrow.down.to.line", help: "Pull…", disabled: busy || noRemotes) {
        Task { await actions.pull() }
      },
      PillAction(
        id: "push", title: current?.upstream == nil ? "Publish" : "Push", symbol: "arrow.up.to.line",
        help: current?.upstream == nil ? "Publish the branch…" : "Push…", disabled: busy || current == nil || noRemotes
      ) { actions.push() },
      workspace.isProjectRoot
        ? PillAction(id: "branch", title: "Branch", symbol: "arrow.triangle.branch", help: "New branch…") {
          actions.newBranch()
        }
        : PillAction(
          id: "branch", title: "Branch", symbol: "arrow.triangle.branch", help: "Rename the session's branch…"
        ) { actions.renameSessionBranch() },
      PillAction(
        id: "stash", title: "Stash", symbol: "tray.and.arrow.down", help: "Stash changes…",
        disabled: busy || workspace.workingCopy.changedCount == 0
      ) { actions.stash() },
    ]
    if workspace.isProjectRoot {
      items.append(PillAction(id: "tag", title: "Tag", symbol: "tag", help: "New tag…") { actions.newTag() })
    }
    items += [
      PillAction(
        id: "undo", title: "Undo", symbol: "arrow.uturn.backward",
        help: undo.undoDescription.map { "Undo \($0)" } ?? "Nothing to undo", disabled: !undo.canUndo
      ) { Task { await workspace.undoLast(redo: false) } },
      PillAction(
        id: "redo", title: "Redo", symbol: "arrow.uturn.forward",
        help: undo.redoDescription.map { "Redo \($0)" } ?? "Nothing to redo", disabled: !undo.canRedo
      ) { Task { await workspace.undoLast(redo: true) } },
      PillAction(id: "refresh", title: "Refresh", symbol: "arrow.clockwise") { Task { await workspace.refreshAll() } },
    ]
    return items
  }
}
