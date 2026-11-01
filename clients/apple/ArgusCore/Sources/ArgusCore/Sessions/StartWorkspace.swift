import ArgusKit
import Foundation
import Observation

/// Where a start composer's first message goes: the checkout in front of you,
/// a new worktree off a base branch, or a branch that already exists.
@MainActor
@Observable
public final class StartWorkspace {
  public enum Kind: String, Sendable {
    case current, worktree, existing
  }

  public var kind: Kind
  /// The new worktree's base, preselected as the desktop does.
  public let bases = BaseBranchPicker()
  /// The branch an existing-branch start checks out; nil until picked.
  public var existingBranch: String?

  public init(kind: Kind = .current) {
    self.kind = kind
  }

  public var base: String? { bases.base }

  /// What the base menu reads while it has no branch to name.
  public var baseTitle: String {
    if let base { return "from \(base)" }
    return bases.loading ? "Loading branches…" : "Project default"
  }

  /// Read once, the first time a new worktree is asked for.
  public func loadBases(repoRoot: String, store: HostStore) async {
    let rootBranch = store.sessionsByRepo[repoRoot]?.first { $0.kind == .projectRoot }?.branch
    await bases.load(repoRoot: repoRoot, projectRootBranch: rootBranch, store: store)
  }

  /// "Current checkout" on a project's root, "This worktree" on a worktree, "This session" elsewhere.
  public static func currentLabel(for kind: RemoteSessionKind?) -> String {
    if kind == .projectRoot { return "Current checkout" }
    return kind == .worktree ? "This worktree" : "This session"
  }

  public static let worktreeLabel = "New worktree"
  public static let worktreeHint = "A new branch, named from the prompt"
  public static let existingLabel = "Existing branch"
}
