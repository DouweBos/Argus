import ArgusUI
import GroveKit
import SwiftUI

/// The git panel's toolbar: fetch, pull, push, branch, stash, tag.
struct GitToolbarActions: ToolbarContent {
  let workspace: GitWorkspace
  let session: RemoteSession

  var body: some ToolbarContent {
    ToolbarItemGroup {
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
    let actions = RefActions(workspace: workspace, session: session, model: model, theme: theme)
    let undo = workspace.undo
    let busy = workspace.hostBusy != nil
    let current = actions.currentBranch
    if let label = workspace.hostBusy {
      ProgressView().controlSize(.small).help(label).accessibilityLabel(label)
    }
    Button { Task { await actions.fetch() } } label: { Label("Fetch", systemImage: "arrow.down.circle") }
      .help("Fetch from all remotes")
      .disabled(busy)
    Button { Task { await actions.pull() } } label: { Label("Pull", systemImage: "arrow.down.to.line") }
      .help("Pull…")
      .disabled(busy || workspace.refs.remotes.isEmpty)
    Button { actions.push() } label: {
      Label(current?.upstream == nil ? "Publish" : "Push", systemImage: "arrow.up.to.line")
    }
    .help(current?.upstream == nil ? "Publish the branch…" : "Push…")
    .disabled(busy || current == nil || workspace.refs.remotes.isEmpty)
    if workspace.isProjectRoot {
      Button { actions.newBranch() } label: { Label("Branch", systemImage: "arrow.triangle.branch") }
        .help("New branch…")
    } else {
      Button { actions.renameSessionBranch() } label: { Label("Branch", systemImage: "arrow.triangle.branch") }
        .help("Rename the session's branch…")
    }
    Button { actions.stash() } label: { Label("Stash", systemImage: "tray.and.arrow.down") }
      .help("Stash changes…")
      .disabled(busy || workspace.workingCopy.changedCount == 0)
    if workspace.isProjectRoot {
      Button { actions.newTag() } label: { Label("Tag", systemImage: "tag") }
        .help("New tag…")
    }
    Button { Task { await workspace.undoLast(redo: false) } } label: {
      Label("Undo", systemImage: "arrow.uturn.backward")
    }
    .help(undo.undoDescription.map { "Undo \($0)" } ?? "Nothing to undo")
    .disabled(!undo.canUndo)
    Button { Task { await workspace.undoLast(redo: true) } } label: {
      Label("Redo", systemImage: "arrow.uturn.forward")
    }
    .help(undo.redoDescription.map { "Redo \($0)" } ?? "Nothing to redo")
    .disabled(!undo.canRedo)
    Button { Task { await workspace.refreshAll() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
      .help("Refresh")
  }
}
