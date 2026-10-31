import ArgusKit
import Foundation
import Observation

/// A new worktree's base: the branches it may start from and the one
/// `BaseBranchChoice` preselects, read once from the host.
@MainActor
@Observable
public final class BaseBranchPicker {
  /// The base the user picked; nil keeps the preselected one.
  public var picked: String?
  public private(set) var options: [String] = []
  public private(set) var preselected: String?
  public private(set) var loading = false
  private var loaded = false

  public init() {}

  public var base: String? { picked ?? preselected }

  /// Read once, when a worktree is first asked for — the current checkout never needs them.
  public func load(repoRoot: String, projectRootBranch: String?, store: HostStore) async {
    guard !loaded, let backend = store.backend else { return }
    loaded = true
    loading = true
    let source = await Self.source(repoRoot: repoRoot, backend: backend)
    loading = false
    guard let source else { return }
    options = BaseBranchChoice.options(
      local: source.local, originRefs: source.originRefs, protected: source.protectedBranches)
    preselected = BaseBranchChoice.preselected(
      local: source.local, originRefs: source.originRefs,
      configured: source.defaultBaseBranch.flatMap { $0.isEmpty ? nil : $0 },
      protected: source.protectedBranches, projectRootBranch: projectRootBranch)
  }

  private static func source(repoRoot: String, backend: any HostBackend) async
    -> (local: [String], originRefs: [String], protectedBranches: [String], defaultBaseBranch: String?)?
  {
    async let list = try? backend.request(ArgusProtocol.Commands.ListAllBranches.self, .init(repoRoot: repoRoot))
    async let config = try? backend.request(ArgusProtocol.Commands.ReadArgusConfig.self, .init(repoRoot: repoRoot))
    let (branches, argus) = await (list, config)
    guard let branches else { return nil }
    return (
      local: branches.local, originRefs: branches.originRefs, protectedBranches: argus?.protectedBranches ?? [],
      defaultBaseBranch: argus?.defaultBaseBranch)
  }
}
