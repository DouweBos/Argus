import Foundation

/// A git panel view as its pill bar shows it, Grove's `RepositoryTab`. Each
/// maps onto a `GitRoute`; the bar only navigates.
enum GitTab: Hashable {
  case changes, branch, history, stashes, pullRequests, branchesReview, conflicts
  case reflog, blame, bisect, hooks, submodules, settings
  /// Opened from a ref's or commit's menu, never from the bar; a pill while open.
  case compare, interactiveRebase

  /// Always shown; the rest live in the More menu and get a pill only while open.
  static func primary(isProject: Bool) -> [GitTab] {
    isProject ? [.changes, .history, .stashes, .pullRequests, .branchesReview] : [.changes, .branch, .stashes]
  }

  static func secondary(isProject: Bool) -> [GitTab] {
    isProject ? [.reflog, .blame, .bisect, .hooks, .submodules, .settings] : [.reflog, .blame]
  }

  /// Ref routes are filtered history, so they keep History lit, as in Grove.
  init(route: GitRoute) {
    switch route {
    case .working: self = .changes
    case .branch: self = .branch
    case .history, .branches, .tags: self = .history
    case .stashes: self = .stashes
    case .pullRequests: self = .pullRequests
    case .branchesReview: self = .branchesReview
    case .conflicts: self = .conflicts
    case .reflog: self = .reflog
    case .blame: self = .blame
    case .bisect: self = .bisect
    case .hooks: self = .hooks
    case .submodules: self = .submodules
    case .settings: self = .settings
    case .compare: self = .compare
    case .interactiveRebase: self = .interactiveRebase
    }
  }

  /// Where picking the tab goes; nil for the views only a ref or commit opens.
  var route: GitRoute? {
    switch self {
    case .changes: .working
    case .branch: .branch
    case .history: .history
    case .stashes: .stashes
    case .pullRequests: .pullRequests
    case .branchesReview: .branchesReview
    case .conflicts: .conflicts
    case .reflog: .reflog
    case .blame: .blame(path: nil, ref: nil)
    case .bisect: .bisect
    case .hooks: .hooks
    case .submodules: .submodules
    case .settings: .settings
    case .compare, .interactiveRebase: nil
    }
  }

  var title: String {
    switch self {
    case .changes: "Changes"
    case .branch: "Branch"
    case .history: "History"
    case .stashes: "Stashes"
    case .pullRequests: "Pull Requests"
    case .branchesReview: "Branches Review"
    case .conflicts: "Conflicts"
    case .reflog: "Reflog"
    case .blame: "Blame"
    case .bisect: "Bisect"
    case .hooks: "Hooks"
    case .submodules: "Submodules"
    case .settings: "Settings"
    case .compare: "Compare"
    case .interactiveRebase: "Interactive Rebase"
    }
  }

  var symbol: String {
    switch self {
    case .changes: "tray"
    case .branch: "arrow.triangle.branch"
    case .history: "clock"
    case .stashes: "tray.2"
    case .pullRequests: "arrow.triangle.pull"
    case .branchesReview: "checklist"
    case .conflicts: "exclamationmark.triangle"
    case .reflog: "clock.arrow.circlepath"
    case .blame: "person.text.rectangle"
    case .bisect: "scope"
    case .hooks: "link"
    case .submodules: "shippingbox"
    case .settings: "gearshape"
    case .compare: "arrow.left.arrow.right"
    case .interactiveRebase: "list.number"
    }
  }
}
