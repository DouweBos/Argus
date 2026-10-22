import AppKit
import SwiftUI

/// A Git menu action. Sheets need the git panel's theme and session, so, as Grove's
/// `GroveAction`, the menu posts it and the panel on screen runs it.
enum GitMenuAction: String, CaseIterable {
  case fetch, pull, push, branch, merge, rebase, createPullRequest, commit, stash

  static let notification = Notification.Name("ArgusGitMenuAction")

  func post(to sessionId: String) {
    NotificationCenter.default.post(
      name: Self.notification, object: nil, userInfo: ["action": rawValue, "sessionId": sessionId])
  }

  /// The action a notification carries, if it's for `sessionId`.
  init?(_ notification: Notification, sessionId: String) {
    guard notification.userInfo?["sessionId"] as? String == sessionId,
      let raw = notification.userInfo?["action"] as? String
    else { return nil }
    self.init(rawValue: raw)
  }

  var telemetry: MacTelemetryEvent.MenuCommandAction {
    switch self {
    case .fetch: .gitFetch
    case .pull: .gitPull
    case .push: .gitPush
    case .branch: .gitBranch
    case .merge: .gitMerge
    case .rebase: .gitRebase
    case .createPullRequest: .gitCreatePullRequest
    case .commit: .gitCommit
    case .stash: .gitStash
    }
  }
}

extension DesktopModel {
  /// The open repository of the git panel on screen, which the Git menu acts on.
  var gitInFront: GitWorkspace? {
    guard case .sessionGit(let id, _) = route, KeyWindow.shared.isMain else { return nil }
    return git.workspace(id)
  }

  /// The git sub-view on screen, if any.
  var gitView: GitRoute? {
    guard case .sessionGit(_, let view) = route else { return nil }
    return view
  }
}

/// The Git menu, Grove's shortcuts. Keys something else also uses (⇧⌘P, ⇧⌘F, ⌘B, ⇧⌘M, ⌘↩) are
/// only bound while the git panel is in front, as Electron's `GIT_PANEL_SUPPRESSED`.
struct GitMenuCommands: View {
  let model: DesktopModel

  var body: some View {
    let workspace = model.gitInFront
    let owned = workspace != nil
    let busy = workspace?.hostBusy != nil
    let refs = workspace?.refs
    let hasHead = refs?.localBranches.contains(where: \.isHEAD) == true
    let noRemotes = refs?.remotes.isEmpty ?? true
    let hasOtherBranch = (refs?.localBranches.count ?? 0) > 1
    item(.fetch, "Fetch", "f", [.command, .shift], owned: owned, disabled: busy)
    item(.pull, "Pull…", "p", [.command, .shift], owned: owned, disabled: busy || noRemotes)
    item(.push, "Push…", "u", [.command, .shift], disabled: busy || !hasHead || noRemotes)
    Divider()
    // A worktree session's branch is the session's, so the toolbar's Branch renames it.
    item(
      .branch, workspace?.isProjectRoot == false ? "Rename Session Branch…" : "New Branch…", "b", .command,
      owned: owned, disabled: busy)
    Divider()
    item(.merge, "Merge…", "m", [.command, .shift], owned: owned, disabled: busy || !hasHead || !hasOtherBranch)
    item(.rebase, "Rebase…", "r", [.command, .shift], disabled: busy || !hasHead || !hasOtherBranch)
    item(.createPullRequest, "Create Pull Request…", nil)
    Divider()
    // A pull request's comment box sends on ⌘↩ too.
    item(
      .commit, "Commit", .return, .command, owned: owned && model.gitView != .pullRequests,
      disabled: workspace?.workingCopy.canCommit != true)
    item(.stash, "Stash…", "s", [.command, .shift], disabled: busy || (workspace?.workingCopy.changedCount ?? 0) == 0)
  }

  private func item(
    _ action: GitMenuAction, _ title: String, _ key: KeyEquivalent?, _ modifiers: EventModifiers = [],
    owned: Bool = true, disabled: Bool = false
  ) -> some View {
    Button(title) { MenuCommand.git(action).run(model) }
      .keyboardShortcut(key.flatMap { owned ? KeyboardShortcut($0, modifiers: modifiers) : nil })
      .disabled(model.gitInFront == nil || disabled)
  }
}
