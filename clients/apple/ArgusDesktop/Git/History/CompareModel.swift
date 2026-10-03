import Foundation
import GroveKit
import Observation

/// One `left...right` comparison: the commits only on each side, the merge
/// base, whether merging would conflict, and the files `right` changed since
/// the merge base.
@MainActor
@Observable
final class CompareModel {
  private(set) var comparison: BranchComparison?
  private(set) var mergeBase: String?
  private(set) var wouldConflict: Bool?
  private(set) var files: [FileDiff] = []
  private(set) var isLoading = false
  private(set) var isLoadingFiles = false
  private(set) var errorMessage: String?
  private var loadedKey: String?

  func load(workspace: GitWorkspace, left: String, right: String) async {
    let key = "\(left)...\(right)"
    let isNewPair = key != loadedKey
    loadedKey = key
    if isNewPair {
      comparison = nil
      files = []
      mergeBase = nil
      wouldConflict = nil
    }
    errorMessage = nil
    isLoading = true
    isLoadingFiles = true
    let shell = GitShell(workingDirectory: workspace.repository.path, runner: LocalGitRunner())
    async let precheck = Self.precheck(shell: shell, left: left, right: right)
    do {
      let result = try await workspace.repository.compareBranches(base: left, compare: right)
      guard loadedKey == key else { return }
      comparison = result
    } catch {
      guard loadedKey == key else { return }
      errorMessage = error.localizedDescription
    }
    isLoading = false
    let (base, conflicts) = await precheck
    guard loadedKey == key else { return }
    mergeBase = base
    wouldConflict = conflicts
    let diffs = try? await Self.diffs(repository: workspace.repository, shell: shell, base: base, right: right)
    guard loadedKey == key else { return }
    files = diffs ?? []
    isLoadingFiles = false
  }

  /// `merge-tree --write-tree` merges in memory: exit 0 is clean, 1 conflicts,
  /// anything else (an old git) leaves the answer unknown.
  private static func precheck(shell: GitShell, left: String, right: String) async -> (String?, Bool?) {
    let base = try? await shell.run(["merge-base", left, right]).stdout
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let base, !base.isEmpty else { return (nil, nil) }
    let merge = try? await shell.runAllowingFailure(["merge-tree", "--write-tree", "--name-only", left, right])
    switch merge?.exitCode {
    case 0: return (base, false)
    case 1: return (base, true)
    default: return (base, nil)
    }
  }

  /// GroveKit only diffs commits, so the range diff is a commit object made
  /// for it: `right`'s tree on the merge base. No ref, index or worktree is
  /// touched, and fixed identity and dates make it the same object every time.
  private static func diffs(repository: GitRepository, shell: GitShell, base: String?, right: String) async throws
    -> [FileDiff]
  {
    let env = [
      "GIT_AUTHOR_NAME": "Argus", "GIT_AUTHOR_EMAIL": "argus@localhost", "GIT_AUTHOR_DATE": "1970-01-01T00:00:00Z",
      "GIT_COMMITTER_NAME": "Argus", "GIT_COMMITTER_EMAIL": "argus@localhost",
      "GIT_COMMITTER_DATE": "1970-01-01T00:00:00Z",
    ]
    var args = ["commit-tree", "\(right)^{tree}", "-m", "compare"]
    if let base, !base.isEmpty { args += ["-p", base] }
    let sha = try await shell.run(args, environment: env).stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    return try await repository.diffForCommit(sha)
  }
}
