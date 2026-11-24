import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// History, Compare and Interactive Rebase from GroveUIKit, with Argus's own parts: routes instead of sheets for
/// compare, rebase and blame, the session branch's own commits over its base, and review comments on a comparison.
/// Checkout, branch and tag run through the host's commands; the history rewrites through GroveKit, as before.
struct HistoryScreen: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let history: HistoryViewModel
  let ref: String?
  let baseBranch: String?
  @State private var ownCommits: Set<String>?

  var body: some View {
    GitHistoryView(viewModel: history, dialogs: workspace.dialogContext, host: host)
      .gitPanelPadding()
      .gitFeatures(workspace.features)
      .gitUIHost(.argus(openLine: nil))
      .task {
        let navigate = navigator
        history.onRebaseStopped = { navigate(.conflicts) }
        history.onOpenBlame = { path, revision in navigate(.blame(path: path, ref: revision)) }
      }
      .task(id: OwnKey(base: baseBranch, generation: workspace.generation)) { await loadOwnCommits() }
  }

  private var host: GitHistoryHost {
    var host = GitHistoryHost.argus(workspace: workspace, navigate: navigator)
    if let baseBranch { host.title = "\(history.headBranchName ?? "Branch") vs \(baseBranch)" }
    host.ownCommits = ownCommits
    return host
  }

  private var navigator: (GitRoute) -> Void {
    { [model, workspace] route in model.navigate(.sessionGit(id: workspace.sessionId, view: route)) }
  }

  private struct OwnKey: Hashable {
    let base: String?
    let generation: Int
  }

  /// On the session branch's view, the commits its base doesn't have; the rest show dimmed.
  private func loadOwnCommits() async {
    guard let baseBranch else { return ownCommits = nil }
    ownCommits = (try? await workspace.repository.commits(in: "HEAD", notIn: baseBranch)) ?? nil
  }
}

/// Two refs from the route, compared; picking another ref navigates. Its diffs take review comments.
struct CompareView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let left: String
  let right: String

  var body: some View {
    GitCompareView(
      context: workspace.dialogContext,
      base: Binding(get: { left }, set: { navigate(.compare(left: $0, right: right)) }),
      compare: Binding(get: { right }, set: { navigate(.compare(left: left, right: $0)) }), host: host)
      .gitPanelPadding()
      .gitFeatures(workspace.features)
      .gitUIHost(.argus(openLine: nil))
  }

  private var host: GitHistoryHost {
    var host = GitHistoryHost.argus(workspace: workspace, navigate: navigate)
    host.compareAnnotations = { [model, workspace, theme] path, base, compare in
      DiffReviewContext.session(
        workspace.sessionId, path: path, scope: "diff from \(base) to \(compare)", store: model.store
      ).annotations(theme: theme)
    }
    return host
  }

  private func navigate(_ route: GitRoute) {
    model.navigate(.sessionGit(id: workspace.sessionId, view: route))
  }
}

/// The rebase planner as its own view; it goes back to History when done or to Conflicts when it stops.
struct InteractiveRebaseView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let from: String

  var body: some View {
    GitInteractiveRebaseView(viewModel: workspace.history, from: from) { navigate(.history) }
      .gitPanelPadding()
      .gitFeatures(workspace.features)
      .task { workspace.history.onRebaseStopped = { [model, workspace] in
        model.navigate(.sessionGit(id: workspace.sessionId, view: .conflicts))
      } }
  }

  private func navigate(_ route: GitRoute) {
    model.navigate(.sessionGit(id: workspace.sessionId, view: route))
  }
}

extension GitHistoryHost {
  /// Compare, rebase and blame open as routes; no avatars are fetched, so no author's email leaves the Mac.
  @MainActor
  static func argus(workspace: GitWorkspace, navigate: @escaping (GitRoute) -> Void) -> GitHistoryHost {
    var host = GitHistoryHost()
    host.compare = { navigate(.compare(left: $0, right: $1)) }
    host.interactiveRebase = { navigate(.interactiveRebase(from: $0.id)) }
    host.openBlame = { navigate(.blame(path: $0, ref: $1)) }
    host.showInHistory = { [weak workspace] sha in
      navigate(.history)
      Task { await workspace?.history.reveal(sha) }
    }
    host.diffOptions = DiffViewSettings.shared.options
    return host
  }
}

extension GitWorkspace {
  /// New Branch and New Tag at a commit, and Compare's merge and rebase, through the host.
  var dialogContext: GitDialogContext {
    var context = GitDialogContext(repository: repository, refs: refs, commands: commands)
    context.undo = undo
    return context
  }
}
