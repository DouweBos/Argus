import AppKit
import ArgusKit
import ArgusUI
import GroveKit

/// Why a git command didn't run, worded for the notice and bucketed for telemetry.
struct GitRefusal: Equatable {
  let kind: MacTelemetryEvent.GitRefusalReason
  let message: String
}

extension GitMenuAction {
  func refusal(features: Set<GitFeature>) -> GitRefusal? {
    guard let feature, !features.contains(feature) else { return nil }
    return GitRefusal(kind: .unsupported, message: feature.unavailableReason)
  }

  /// What the repository's current state rules out.
  @MainActor
  func refusal(in workspace: GitWorkspace) -> GitRefusal? {
    if self == .createPullRequest { return nil }
    if let busy = workspace.hostBusy { return GitRefusal(kind: .busy, message: "Wait for this to finish: \(busy)") }
    let refs = workspace.refs
    let onBranch = refs.localBranches.contains(where: \.isHEAD)
    let changes = workspace.workingCopy
    switch self {
    case .pull, .push:
      if refs.remotes.isEmpty { return GitRefusal(kind: .noRemote, message: "This repository has no remote") }
      if self == .push, !onBranch { return GitRefusal(kind: .noBranch, message: "Check out a branch first") }
    case .merge, .rebase:
      if !onBranch { return GitRefusal(kind: .noBranch, message: "Check out a branch first") }
      if refs.localBranches.count < 2 { return GitRefusal(kind: .noBranch, message: "There is no other branch") }
    case .commit:
      if let reason = changes.commitBlocker { return GitRefusal(kind: .cannotCommit, message: reason) }
    case .stash, .snapshot:
      if changes.changedCount == 0 { return GitRefusal(kind: .noChanges, message: "There are no changes to save") }
    case .undo:
      if !workspace.undo.canUndo { return GitRefusal(kind: .nothingToUndo, message: "There is no git action to undo") }
    case .fetch, .branch, .createPullRequest:
      break
    }
    return nil
  }
}

extension WorkingCopyViewModel {
  var commitBlocker: String? {
    if !conflictedFiles.isEmpty { return "Resolve the conflicts first" }
    if !isAmend && stagedFiles.isEmpty { return "Stage changes to commit" }
    if commitSubject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Enter a summary" }
    // All that is left of `canCommit`.
    if !canCommit { return "A commit is already running" }
    return nil
  }
}

extension DesktopModel {
  func gitFeatures(_ session: RemoteSession) -> Set<GitFeature> {
    GitFeature.supported(isProjectRoot: session.kind == .projectRoot, isRemote: host(ofSession: session.id) != Hosts.local)
  }

  /// One path for menus, keys and buttons: opens the repository if needed and waits for what the command reads.
  func runGitCommand(_ action: GitMenuAction, via: MacTelemetryEvent.MenuCommandSource) {
    guard let session = gitSession, gitNotice?.running != action else { return }
    if let refusal = action.refusal(features: gitFeatures(session)) {
      return refuse(action, refusal, in: session.id, via: via)
    }
    MacTelemetry.capture(.menuCommandUsed(action: action.telemetry, via: via))
    gitNotice = GitNotice(sessionId: session.id, running: action)
    Task {
      let workspace = await git.ready(session)
      await workspace?.prepare(for: action)
      // Left the session, or something else took the window, while it loaded.
      guard route.sessionId == session.id, KeyWindow.shared.takesCommands else {
        gitNotice = nil
        return
      }
      guard let workspace else {
        return refuse(
          action, GitRefusal(kind: .notReady, message: "Couldn't open the repository"), in: session.id, via: via)
      }
      if let refusal = action.refusal(in: workspace) { return refuse(action, refusal, in: session.id, via: via) }
      gitNotice = GitNotice(sessionId: session.id)
      await perform(action, workspace: workspace, session: session)
    }
  }

  private func refuse(
    _ action: GitMenuAction, _ refusal: GitRefusal, in sessionId: String,
    via: MacTelemetryEvent.MenuCommandSource
  ) {
    gitNotice = GitNotice(sessionId: sessionId, message: refusal.message)
    MacTelemetry.capture(.gitCommandRefused(action: action.telemetry, reason: refusal.kind, via: via))
  }

  private func perform(_ action: GitMenuAction, workspace: GitWorkspace, session: RemoteSession) async {
    let dark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    // A menu has no environment to read the theme from.
    let theme = Theme.resolved(for: dark ? .dark : .light, colorTheme: AppPreferences.shared.colorTheme)
    let actions = RefActions(workspace: workspace, session: session, model: self, theme: theme)
    switch action {
    case .fetch: await actions.fetch()
    case .pull: await actions.pull()
    case .push: actions.push()
    case .branch:
      if gitFeatures(session).contains(.createBranch) { actions.newBranch() } else { actions.renameSessionBranch() }
    case .merge: actions.chooseMerge()
    case .rebase: actions.chooseRebase()
    case .createPullRequest: actions.createPullRequest()
    case .commit: await WorkingCopyActions(workspace: workspace).commit()
    case .stash: actions.stash()
    case .snapshot: actions.snapshot()
    case .undo: await workspace.undoLast(redo: false)
    }
  }
}

extension GitWorkspace {
  /// What a command checks and its dialog lists. Off screen nothing is watching, so it's read again.
  func prepare(for action: GitMenuAction) async {
    if isActive { await refs.loadIfNeeded() } else { await refs.refresh() }
    if action.readsChanges { await workingCopy.refresh() }
  }
}
