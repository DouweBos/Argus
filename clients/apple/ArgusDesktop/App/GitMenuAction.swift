import GroveKit
import SwiftUI

/// The git commands the menu, the keys and the tooltips share.
enum GitMenuAction: String, CaseIterable {
  case fetch, pull, push, branch, merge, rebase, createPullRequest, commit, stash, snapshot, undo

  var chord: ShortcutChord? {
    switch self {
    case .fetch: .fetch
    case .pull: .pull
    case .push: .push
    case .branch: .branch
    case .merge: .merge
    case .rebase: .rebase
    case .createPullRequest: nil
    case .commit: .commit
    case .stash: .stash
    case .snapshot: .snapshot
    case .undo: .undo
    }
  }

  func title(_ features: GitFeatures) -> String {
    switch self {
    case .fetch: "Fetch"
    case .pull: "Pull"
    case .push: "Push"
    case .branch: features.contains(.createBranch) ? "New Branch" : "Rename Session Branch"
    case .merge: "Merge"
    case .rebase: "Rebase"
    case .createPullRequest: "Create Pull Request"
    case .commit: "Commit"
    case .stash: "Stash"
    case .snapshot: "Save Snapshot"
    case .undo: "Undo Git Action"
    }
  }

  /// What the session must support; Branch renames the session's branch without `createBranch`.
  var feature: GitFeature? {
    switch self {
    case .push: .push
    case .merge: .merge
    case .rebase: .rebase
    default: nil
    }
  }

  var readsChanges: Bool { self == .commit || self == .stash || self == .snapshot }

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
    case .snapshot: .gitSnapshot
    case .undo: .gitUndo
    }
  }
}
