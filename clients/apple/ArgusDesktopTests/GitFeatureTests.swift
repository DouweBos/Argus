import Foundation
import Testing

@testable import Argus

struct GitFeatureTests {
  /// Every host command that calls `requireProjectScope`, by the feature that stands for it.
  private static let hostCommands: [String: GitFeature] = [
    "gitCreateBranch": .createBranch, "gitDeleteBranch": .editBranches, "gitRenameBranch": .editBranches,
    "gitSetUpstream": .editBranches, "gitCheckout": .checkout, "gitStashAndCheckout": .checkout,
    "gitDiscardAndCheckout": .checkout, "gitMergeBranch": .merge, "gitRebaseOnto": .rebase,
    "gitCreateTag": .tag, "gitDeleteTag": .tag, "gitPushTag": .tag,
    "gitAddRemote": .remotes, "gitRemoveRemote": .remotes, "gitRenameRemote": .remotes,
    "gitSetRemoteUrl": .remotes, "gitPruneRemote": .remotes,
    "gitSubmoduleInit": .submodules, "gitSubmoduleUpdate": .submodules, "gitSubmoduleDeinit": .submodules,
    "gitBisectStart": .bisect, "gitBisectGood": .bisect, "gitBisectBad": .bisect, "gitBisectSkip": .bisect,
    "gitBisectReset": .bisect,
  ]
  /// GroveKit runs these on a worktree's own branch, so the host's rule doesn't apply.
  private static let runByGroveKit: Set<String> = ["gitReset", "gitCherryPick"]

  @Test func agreesWithTheHostsProjectScopeRules() throws {
    let scoped = try Self.projectScopedHostFunctions()
    #expect(scoped == Set(Self.hostCommands.keys).union(Self.runByGroveKit))
    #expect(Set(Self.hostCommands.values) == GitFeature.projectRootOnly)
  }

  @Test(arguments: [true, false], [true, false])
  func supportedFollowsScopeAndMachine(isProjectRoot: Bool, isRemote: Bool) {
    let features = GitFeature.supported(isProjectRoot: isProjectRoot, isRemote: isRemote)
    for feature in GitFeature.allCases {
      let allowed =
        (isProjectRoot || !GitFeature.projectRootOnly.contains(feature))
        && (!isRemote || !GitFeature.localOnly.contains(feature))
      #expect(features.contains(feature) == allowed)
    }
    #expect(features.contains(.push))
  }

  @Test func aWorktreeRefusesMergeAndRebaseAndRenamesOnBranch() {
    let features = GitFeature.supported(isProjectRoot: false, isRemote: false)
    let refused = GitMenuAction.allCases.filter { $0.refusal(features: features) != nil }
    #expect(refused == [.merge, .rebase])
    #expect(GitMenuAction.branch.title(features) == "Rename Session Branch")
  }

  private static func projectScopedHostFunctions() throws -> Set<String> {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let directory = root.appendingPathComponent("packages/host/src/services/session")
    var found: Set<String> = []
    for name in try FileManager.default.contentsOfDirectory(atPath: directory.path)
    where name.hasSuffix(".ts") && !name.hasSuffix(".test.ts") {
      var current: String?
      for line in try String(contentsOf: directory.appendingPathComponent(name), encoding: .utf8)
        .components(separatedBy: "\n")
      {
        if let match = line.firstMatch(of: /^(?:export )?(?:async )?function (\w+)/) { current = String(match.1) }
        guard line.contains("requireProjectScope("), !line.hasPrefix("function "), let current else { continue }
        found.insert(current)
      }
    }
    return found
  }
}
