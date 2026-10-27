import ArgusUI
import GroveKit
import SwiftUI

/// The git panel's toolbar, as Grove's: refresh, pull, push and sync, with
/// fetch, branch, stash, tag, undo and redo in the ⋯ menu.
struct GitToolbarActions: ToolbarContent {
  let workspace: GitWorkspace
  let session: RemoteSession

  var body: some ToolbarContent {
    ToolbarItem {
      GitToolbarButtons(workspace: workspace, session: session)
        .environment(\.pillItemsInGlass, true)
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
    let actions = RefActions(workspace: workspace, session: session, model: model, theme: theme)
    // What doesn't fit beside the switcher overflows, so the switcher never moves.
    PillActionGroup(
      actions: primary(actions), menu: menu(actions),
      width: model.toolbarLayout.panelActionsWidth - (workspace.hostBusy == nil ? 0 : PillMetrics.iconWidth)
    ) {
      if let label = workspace.hostBusy {
        ProgressView().controlSize(.small).frame(width: PillMetrics.iconWidth).help(label).accessibilityLabel(label)
      }
    }
  }

  private func primary(_ actions: RefActions) -> [PillAction] {
    let busy = workspace.hostBusy != nil
    let current = actions.currentBranch
    let noRemotes = workspace.refs.remotes.isEmpty
    return [
      PillAction(id: "refresh", title: "Refresh", symbol: "arrow.clockwise") { Task { await workspace.refreshAll() } },
      PillAction(id: "pull", title: "Pull", symbol: "arrow.down.to.line", help: "Pull…", disabled: busy || noRemotes) {
        Task { await actions.pull() }
      },
      PillAction(
        id: "push", title: current?.upstream == nil ? "Publish" : "Push", symbol: "arrow.up.to.line",
        help: current?.upstream == nil ? "Publish the branch…" : "Push…", disabled: busy || current == nil || noRemotes
      ) { actions.push() },
      PillAction(
        id: "sync", title: "Sync", symbol: "arrow.triangle.2.circlepath", help: "Sync: fetch, pull, then push",
        disabled: busy || current == nil || noRemotes
      ) { Task { await actions.sync() } },
    ]
  }

  private func menu(_ actions: RefActions) -> [PillAction] {
    let undo = workspace.undo
    let busy = workspace.hostBusy != nil
    var items = [
      PillAction(id: "fetch", title: "Fetch", symbol: "arrow.down.circle", help: "Fetch from all remotes", disabled: busy) {
        Task { await actions.fetch() }
      },
      workspace.isProjectRoot
        ? PillAction(id: "branch", title: "New Branch…", symbol: "arrow.triangle.branch") { actions.newBranch() }
        : PillAction(id: "branch", title: "Rename Branch…", symbol: "arrow.triangle.branch") {
          actions.renameSessionBranch()
        },
      PillAction(
        id: "stash", title: "Stash Changes…", symbol: "tray.and.arrow.down",
        disabled: busy || workspace.workingCopy.changedCount == 0
      ) { actions.stash() },
    ]
    if workspace.isProjectRoot {
      items.append(PillAction(id: "tag", title: "New Tag…", symbol: "tag") { actions.newTag() })
    }
    items += [
      PillAction(
        id: "undo", title: undo.undoDescription.map { "Undo \($0)" } ?? "Undo", symbol: "arrow.uturn.backward",
        disabled: !undo.canUndo
      ) { Task { await workspace.undoLast(redo: false) } },
      PillAction(
        id: "redo", title: undo.redoDescription.map { "Redo \($0)" } ?? "Redo", symbol: "arrow.uturn.forward",
        disabled: !undo.canRedo
      ) { Task { await workspace.undoLast(redo: true) } },
    ]
    return items
  }
}
