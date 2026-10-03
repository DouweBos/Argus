import Foundation

/// A session's git sub-view: `/sessions/:sessionId/git/:gitView`, as in
/// `docs/routing.md`. Ref routes (`branches/:name`, `tags/:name`) show the
/// history filtered to that ref.
enum GitRoute: Hashable {
  case working
  /// The session branch's own commits against its base.
  case branch
  case history
  case stashes
  case reflog
  case conflicts
  /// History filtered to a branch; nil is the bare `/git/branches`, all branches.
  case branches(String?)
  case tags(String)
  case submodules
  case bisect
  case hooks
  case compare(left: String, right: String)
  case blame(path: String?, ref: String?)
  case settings
  case pullRequests
  case branchesReview
  case interactiveRebase(from: String)

  /// The `:gitView` segment, never a ref name or a path — what telemetry may see.
  var segment: String {
    switch self {
    case .working: "working"
    case .branch: "branch"
    case .history: "history"
    case .stashes: "stashes"
    case .reflog: "reflog"
    case .conflicts: "conflicts"
    case .branches(let name): name == nil ? "branches" : "branches/:branchName"
    case .tags: "tags/:tagName"
    case .submodules: "submodules"
    case .bisect: "bisect"
    case .hooks: "hooks"
    case .compare: "compare"
    case .blame: "blame"
    case .settings: "settings"
    case .pullRequests: "pull-requests"
    case .branchesReview: "branches-review"
    case .interactiveRebase: "interactive-rebase"
    }
  }

  /// The ref a history route is filtered to, if any.
  var historyRef: String? {
    switch self {
    case .branches(let name): name
    case .tags(let name): name
    default: nil
    }
  }

  /// Ref routes render the history view.
  var showsHistory: Bool {
    switch self {
    case .history, .branches, .tags: true
    default: false
    }
  }

  /// Views that only make sense on the project-root session, as in Electron.
  var isProjectScope: Bool {
    switch self {
    case .history, .branches, .tags, .submodules, .bisect, .hooks, .settings, .pullRequests,
      .branchesReview:
      true
    default: false
    }
  }

  /// `view[:arg[:arg]]`, for `ARGUS_DEV_ROUTE` and the dev driver.
  init?(devString raw: String) {
    let parts = raw.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
    let arg = parts.count > 1 ? parts[1] : nil
    let arg2 = parts.count > 2 ? parts[2] : nil
    switch parts.first {
    case "working": self = .working
    case "branch": self = .branch
    case "history": self = .history
    case "stashes": self = .stashes
    case "reflog": self = .reflog
    case "conflicts": self = .conflicts
    case "branches": self = .branches(arg)
    case "tags": self = .tags(arg ?? "")
    case "submodules": self = .submodules
    case "bisect": self = .bisect
    case "hooks": self = .hooks
    case "compare": self = .compare(left: arg ?? "", right: arg2 ?? "")
    case "blame": self = .blame(path: arg, ref: arg2)
    case "settings": self = .settings
    case "pull-requests": self = .pullRequests
    case "branches-review": self = .branchesReview
    case "interactive-rebase": self = .interactiveRebase(from: arg ?? "")
    default: return nil
    }
  }
}
