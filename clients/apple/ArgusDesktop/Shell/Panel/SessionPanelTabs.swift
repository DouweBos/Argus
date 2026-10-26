import ArgusCore
import ArgusUI
import SwiftUI

/// The Files tab: the code view's navigator (changes, tree, search); a file opens in the code view.
struct SessionFilesTab: View {
  @Environment(DesktopModel.self) private var model
  let session: RemoteSession

  private var activePath: String? {
    if case .sessionCode(_, let path, _) = model.route { path } else { nil }
  }

  var body: some View {
    CodeNavigator(code: model.code.session(session.id), activePath: activePath)
      // The changes list reads the session's repository.
      .task(id: session.id) { _ = await model.code.session(session.id).gitWorkspace() }
  }
}

/// The Diff tab: the session's changes over the picked file's diff, with hunk staging.
struct SessionDiffTab: View {
  @Environment(DesktopModel.self) private var model
  let session: RemoteSession

  /// The git and code views run the same repository; leaving them must not stop it under this tab.
  private var sharedOnScreen: Bool { model.sessionPanel == .git || model.sessionPanel == .code }

  var body: some View {
    Group {
      if case .open(let workspace) = model.git.slots[session.id] {
        ResizableVSplit(key: "panel.diff", topMin: 100, bottomMin: 160, bottomIdeal: 360, showsBottom: true) {
          ChangesListView(workspace: workspace)
        } bottom: {
          WorkingDiffView(workspace: workspace)
        }
        .modifier(DiffTabDialogs(workspace: workspace, shown: model.sessionPanel != .git))
        .task(id: model.sessionPanel) { await workspace.start() }
        .onDisappear { if !sharedOnScreen { workspace.pause() } }
      } else if case .failed(let message) = model.git.slots[session.id] {
        EmptyState(icon: Icon.warning, title: "Couldn't open the repository", body: message)
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .task(id: session.id) { await model.git.open(session) }
  }
}

/// Discard confirmations and the like, unless the git view on screen already presents them.
private struct DiffTabDialogs: ViewModifier {
  let workspace: GitWorkspace
  let shown: Bool

  func body(content: Content) -> some View {
    if shown { content.modifier(WorkingCopyDialogs(workspace: workspace)) } else { content }
  }
}

/// The Pull Request tab: the pull request opened from the session's branch.
struct SessionPullRequestTab: View {
  @Environment(DesktopModel.self) private var model
  let session: RemoteSession

  var body: some View {
    if let pr = model.sessionPullRequest(session) {
      PullRequestDetailScreen(repo: pr.repo, number: pr.number, embedded: true)
        .id(pr.id)
    } else {
      EmptyState(
        icon: PanelTabKind.pullRequest.symbol, title: "No pull request",
        body: "This session's branch has no open pull request yet.")
    }
  }
}
