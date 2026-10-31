import ArgusCore
import Foundation

extension GitRoute {
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
