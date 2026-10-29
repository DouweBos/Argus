import Foundation

/// Which branch a new worktree starts from, as the desktop picks it (`app/lib/baseBranch.ts`).
public enum BaseBranchChoice {
  public static let common = ["staging", "develop", "dev", "main", "master"]

  /// `.argus.json`'s `default_base_branch`, then its protected branches, then the
  /// usual names; `origin/<name>` over a local copy the project root has checked
  /// out, since that one may have drifted. Else the first local branch.
  public static func preselected(
    local: [String], originRefs: [String], configured: String?, protected: [String],
    projectRootBranch: String?
  ) -> String? {
    let origins = Set(originRefs)
    var seen = Set<String>()
    let candidates = (configured.map { [$0] } ?? []) + protected + common
    for name in candidates where seen.insert(name).inserted {
      let origin = "origin/\(name)"
      let hasOrigin = origins.contains(origin)
      if hasOrigin && projectRootBranch == name { return origin }
      if local.contains(name) { return name }
      if hasOrigin { return origin }
    }
    return local.first
  }

  /// The local branches, plus the `origin/*` refs of base-like ones only.
  public static func options(local: [String], originRefs: [String], protected: [String]) -> [String] {
    let hints = Set(protected + common)
    let prefix = "origin/"
    return local + originRefs.filter { $0.hasPrefix(prefix) && hints.contains(String($0.dropFirst(prefix.count))) }
  }
}
