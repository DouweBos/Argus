import ArgusCore
import ArgusUI
import GroveKit
import GroveUIKit
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

/// The Diff tab: the session's changes (uncommitted, one agent turn or the whole branch) over the picked file's diff.
struct SessionDiffTab: View {
  @Environment(DesktopModel.self) private var model
  let session: RemoteSession
  @State private var viewed: ViewedFiles?

  /// The git and code views run the same repository; leaving them must not stop it under this tab.
  private var sharedOnScreen: Bool { model.sessionPanel == .git || model.sessionPanel == .code }

  var body: some View {
    Group {
      if case .open(let workspace) = model.git.slots[session.id] {
        SessionDiffPanel(workspace: workspace, session: session, viewed: viewed)
          .task(id: model.sessionPanel) { await workspace.start() }
          .onDisappear { if !sharedOnScreen { workspace.pause() } }
      } else if case .failed(let message) = model.git.slots[session.id] {
        EmptyState(icon: Icon.warning, title: "Couldn't open the repository", body: message)
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background { DiffTabFocus { model.diffTabFocused = $0 } }
    .task(id: session.id) {
      viewed = ViewedFiles(scope: .session(id: session.id, mode: "working"), host: model.store)
      await model.git.open(session)
    }
  }
}

/// GroveUIKit's compact working copy with Argus's diff scope, viewed marks and review, and no composer: the git view commits.
struct SessionDiffPanel: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let session: RemoteSession
  var viewed: ViewedFiles?
  /// The bottom pane's height from before the kit, so a dragged split stays.
  @AppStorage("split.panel.diff") private var diffHeight: Double = 360

  private var vm: WorkingCopyViewModel { workspace.workingCopy }
  /// The git view on screen shows the review bar, confirmations and patch sheets itself.
  private var gitOnScreen: Bool { model.sessionPanel == .git }

  var body: some View {
    VStack(spacing: 0) {
      if let error = viewed?.error {
        GitErrorBanner(message: error) { viewed?.error = nil }
      }
      GitWorkingCopyView(
        viewModel: vm, host: host, slots: .argus(workspace: workspace, viewed: viewed), layout: .compact(composer: false)
      )
      .padding(8)
      if !gitOnScreen { DiffReviewBar(sessionId: session.id) }
    }
    .gitFeatures(workspace.features)
    .task(id: vm.statusEntries) { await viewed?.load() }
    .onChange(of: workspace.suppressLfsWarning, initial: true) { _, suppressed in
      if suppressed { vm.dismissLFSWarning() }
    }
  }

  private var host: GitWorkingCopyHost {
    var host = GitWorkingCopyHost.argus(workspace: workspace, session: session, model: model)
    host.compactDiffHeight = $diffHeight
    host.presentsDialogs = !gitOnScreen
    return host
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
