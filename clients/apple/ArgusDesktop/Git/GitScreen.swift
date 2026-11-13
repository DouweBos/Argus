import ArgusUI
import GroveKit
import SwiftUI

/// A session's git panel: the git sidebar beside the routed sub-view. Opens
/// the session's repository on first show.
struct GitScreen: View {
  @Environment(DesktopModel.self) private var model
  let session: RemoteSession
  let view: GitRoute

  var body: some View {
    Group {
      switch model.git.slots[session.id] {
      case .open(let workspace):
        GitWorkspaceView(workspace: workspace, session: session, view: view)
          .id(session.id)
      case .failed(let message):
        QuietEmptyState(icon: "exclamationmark.triangle", title: "Couldn't open the repository", message: message) {
          Button("Try Again") {
            model.git.retry(session.id)
            Task { await model.git.open(session) }
          }
        }
      case .opening, nil:
        ProgressView().controlSize(.small)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .task(id: session.id) {
      model.git.show(session.id)
      await model.git.open(session)
    }
  }
}

/// The open repository: sidebar, banners, the views' tab bar and the sub-view,
/// flat on the window's canvas with hairlines between them.
struct GitWorkspaceView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let session: RemoteSession
  let view: GitRoute

  var body: some View {
    // Not a split view: HSplitView holds its sidebar at full width and won't
    // shrink, pushing the panel over the app sidebar and runtime panel.
    HStack(spacing: 0) {
      GitSidebar(workspace: workspace, session: session, view: view)
        .frame(width: 230)
      Rectangle().fill(theme.border).frame(width: 1)
      VStack(spacing: 0) {
        if let failure = workspace.failure {
          GitFailureBanner(workspace: workspace, session: session, failure: failure, canRetry: workspace.retry != nil) {
            workspace.hostError = nil
          }
        }
        if let error = workspace.undo.errorMessage {
          GitErrorBanner(message: "\(workspace.undo.errorTitle): \(error)") { workspace.undo.dismissError() }
        }
        VStack(spacing: 0) {
          GitTabBar(workspace: workspace, view: view)
            .padding(.leading, 6)
            .padding(.trailing, SessionContextCardOverlay.barReserve)
          Rectangle().fill(theme.border).frame(height: 1)
          content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
          DiffReviewBar(sessionId: session.id)
        }
        .sessionContextCard(session, panel: .git, barHeight: GitTabBar.height)
      }
      .frame(minWidth: 420)
    }
    .toolbar { GitToolbarActions(workspace: workspace, session: session) }
    .task {
      workspace.visible = view
      await workspace.start()
    }
    .onChange(of: view) { _, next in workspace.visible = next }
    .onDisappear { workspace.pause() }
    .onReceive(NotificationCenter.default.publisher(for: GitMenuAction.notification)) { note in
      if let action = GitMenuAction(note, sessionId: workspace.sessionId) { perform(action) }
    }
    .background {
      // ⌘Z / ⇧⌘Z undo the last git action, as in Grove.
      Button("Undo") { Task { await workspace.undoLast(redo: false) } }
        .keyboardShortcut("z", modifiers: [.command, .option])
        .disabled(!workspace.undo.canUndo)
        .hidden()
    }
  }

  private func perform(_ action: GitMenuAction) {
    let actions = RefActions(workspace: workspace, session: session, model: model, theme: theme)
    switch action {
    case .fetch: Task { await actions.fetch() }
    case .pull: Task { await actions.pull() }
    case .push: actions.push()
    case .branch: if workspace.isProjectRoot { actions.newBranch() } else { actions.renameSessionBranch() }
    case .merge: actions.chooseMerge()
    case .rebase: actions.chooseRebase()
    case .createPullRequest: actions.createPullRequest()
    case .commit:
      guard workspace.workingCopy.canCommit else { return }
      Task { await WorkingCopyActions(workspace: workspace).commit() }
    case .stash: actions.stash()
    }
  }

  /// Changes, History and Stashes lay out their own panes; the rest fill the room.
  @ViewBuilder
  private var content: some View {
    switch view {
    case .working:
      WorkingCopyView(workspace: workspace)
    case .branch, .history, .branches, .tags:
      HistoryScreen(
        workspace: workspace, history: workspace.visibleHistory ?? workspace.history, ref: view.historyRef,
        baseBranch: view == .branch ? session.baseBranch : nil)
    case .stashes:
      StashesView(workspace: workspace)
    default:
      single
    }
  }

  @ViewBuilder
  private var single: some View {
    switch view {
    case .conflicts:
      ConflictsView(workspace: workspace)
    case .compare(let left, let right):
      CompareView(workspace: workspace, left: left, right: right)
    case .blame(let path, let ref):
      BlameView(workspace: workspace, path: path, ref: ref)
    case .interactiveRebase(let from):
      InteractiveRebaseView(workspace: workspace, from: from)
    case .reflog:
      ReflogView(workspace: workspace)
    case .branchesReview:
      BranchesReviewView(workspace: workspace)
    case .submodules:
      SubmodulesView(workspace: workspace)
    case .bisect:
      BisectView(workspace: workspace)
    case .hooks:
      HooksView(workspace: workspace)
    case .settings:
      GitSettingsView(workspace: workspace)
    case .pullRequests:
      ProjectPullRequestsView(repoRoot: session.repoRoot)
    case .guide:
      ReviewGuideScreen(target: .session(id: session.id))
    case .working, .branch, .history, .branches, .tags, .stashes:
      EmptyView()
    }
  }
}
